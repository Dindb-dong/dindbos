const escape = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateLabel = (key) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const icons = {
  add: '<path d="M10 3v14M3 10h14"/>',
  trash: '<path d="M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v7m4-7v7"/>',
  note: '<rect x="3" y="2" width="14" height="16" rx="2"/><path d="M6 6h8M6 10h8M6 14h5"/>',
  back: '<path d="m12 4-6 6 6 6"/>', next: '<path d="m8 4 6 6-6 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.note}</svg>`;

/** Each app owns one JSON file; flush failure keeps the current edits available. */
export function createProductivityStore(os, name, onError = () => {}) {
  const home = os.session.home || "/home/guest";
  const directory = os.fs.join(os.fs.join(home, "Documents"), ".dindbos");
  const path = os.fs.join(directory, `${name}.json`);
  let items = [];
  if (os.fs.exists(path)) {
    const parsed = JSON.parse(os.fs.readFile(path));
    if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item.id !== "string")) throw new Error(`${name} data could not be read. Your saved file has been kept at ${path}.`);
    items = parsed;
  }
  let timer;
  let pending;
  let revision = 0;
  let savedRevision = 0;
  const write = () => {
    for (const folder of [os.fs.join(home, "Documents"), directory]) {
      if (!os.fs.exists(folder)) os.fs.createDirectory(folder, "/", { owner: os.session.user, group: os.session.user });
    }
    if (os.fs.exists(path)) os.fs.writeFile(path, JSON.stringify(items));
    else os.fs.createFile(path, "/", { content: JSON.stringify(items), mime: "application/json", owner: os.session.user, group: os.session.user });
  };
  const flush = async () => {
    clearTimeout(timer);
    try {
      if (pending) await pending;
      if (savedRevision === revision) return true;
      do {
      const writingRevision = revision;
      write();
      pending = Promise.resolve(os.storage?.sync?.());
      await pending;
      savedRevision = writingRevision;
      } while (savedRevision !== revision);
      onError("");
      return true;
    } catch (error) {
      onError(`Could not save. Your edits are still open. ${error.message}`);
      return false;
    } finally { pending = null; }
  };
  return {
    get items() { return items; },
    set(next) {
      items = next;
      revision++;
      // Write the VFS immediately; the storage backend is debounced below.
      try {
        write();
      } catch (error) { onError(`Could not save. Your edits are still open. ${error.message}`); }
      clearTimeout(timer);
      timer = setTimeout(() => { void flush(); }, 350);
    },
    flush,
    dispose() { clearTimeout(timer); if (savedRevision !== revision) void flush(); },
  };
}

function appSession(os, content, windowApi, name) {
  const controller = new AbortController();
  let renderController = new AbortController();
  let store;
  let error = "";
  const showError = (message) => {
    error = message;
    if (controller.signal.aborted) return;
    const alert = content.querySelector("[data-productivity-error]");
    if (alert) { alert.hidden = !message; alert.querySelector("[data-error-message]").textContent = message; }
  };
  try { store = createProductivityStore(os, name, showError); }
  catch (failure) {
    content.innerHTML = `<section class="productivity-app productivity-unavailable"><h2>Could not open ${escape(name)}</h2><p role="alert">${escape(failure.message)}</p></section>`;
    return null;
  }
  const beforeClose = windowApi.setBeforeClose?.(() => store.flush());
  content.addEventListener("click", (event) => { if (event.target.closest("[data-error-retry]")) void store.flush(); }, { signal: controller.signal });
  return {
    store, signal: controller.signal,
    errorMarkup: () => `<div class="productivity-error" data-productivity-error role="alert" ${error ? "" : "hidden"}><span data-error-message>${escape(error)}</span><button type="button" data-error-retry>Retry Save</button></div>`,
    beginRender() { renderController.abort(); renderController = new AbortController(); },
    listen(element, event, handler) { element?.addEventListener(event, handler, { signal: renderController.signal }); },
    listenPersistent(element, event, handler) { element?.addEventListener(event, handler, { signal: controller.signal }); },
    cleanup() { beforeClose?.(); controller.abort(); renderController.abort(); store.dispose(); },
  };
}

function confirmRemoval(content, title, signal, remove) {
  const previous = document.activeElement;
  const backdrop = document.createElement("div");
  backdrop.className = "productivity-sheet-backdrop";
  backdrop.innerHTML = `<section class="productivity-sheet" role="dialog" aria-modal="true" aria-label="${escape(title)}"><h2>${escape(title)}</h2><p>This item will be removed from this desktop.</p><footer><button type="button" data-cancel>Cancel</button><button type="button" class="is-destructive" data-confirm>Delete</button></footer></section>`;
  const finish = () => { signal.removeEventListener("abort", finish); backdrop.remove(); if (previous?.isConnected) previous.focus(); };
  signal.addEventListener("abort", finish, { once: true });
  backdrop.querySelector("[data-cancel]").onclick = finish;
  backdrop.querySelector("[data-confirm]").onclick = () => { finish(); remove(); };
  trapSheet(backdrop, finish);
  content.append(backdrop);
  backdrop.querySelector("[data-cancel]").focus();
}

function trapSheet(backdrop, cancel) {
  backdrop.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    if (event.key === "Tab") {
      const fields = [...backdrop.querySelectorAll("input,textarea,button")];
      if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0].focus(); }
    }
  });
}

export function renderNotes(os, content, context, windowApi) {
  const app = appSession(os, content, windowApi, "notes");
  if (!app) return () => {};
  let selected = app.store.items[0]?.id;
  let query = "";
  const selectedNote = () => app.store.items.find((note) => note.id === selected);
  const update = (patch) => {
    app.store.set(app.store.items.map((note) => note.id === selected ? { ...note, ...patch, updatedAt: new Date().toISOString() } : note));
    renderList();
  };
  const create = () => {
    const note = { id: uid(), title: "", body: "", updatedAt: new Date().toISOString() };
    app.store.set([note, ...app.store.items]); selected = note.id; draw();
    content.querySelector("[data-note-title]").focus();
  };
  const renderList = () => {
    const list = content.querySelector("[data-note-list]");
    if (!list) return;
    const matches = app.store.items.filter((note) => `${note.title} ${note.body}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    list.innerHTML = matches.length ? matches.map((note) => `<button type="button" data-note-id="${escape(note.id)}" aria-pressed="${selected === note.id}"><strong>${escape(note.title || "Untitled note")}</strong><span>${escape(String(note.body || "No additional text").split("\n").find(Boolean) || "No additional text")}</span><time>${escape(new Date(note.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</time></button>`).join("") : `<p class="productivity-empty-list">${query ? "No matching notes" : "No notes yet"}</p>`;
  };
  const draw = () => {
    app.beginRender();
    const note = selectedNote();
    windowApi.setTitle(note?.title || "Notes");
    content.innerHTML = `<section class="productivity-app notes-app"><aside class="notes-sidebar"><header><strong>Notes <span>${app.store.items.length}</span></strong><button type="button" class="productivity-icon-button" data-note-new aria-label="New note">${icon("add")}</button></header><label class="productivity-search"><input type="search" aria-label="Search notes" placeholder="Search notes" value="${escape(query)}"></label><div class="notes-list" data-note-list></div></aside><main class="note-editor">${app.errorMarkup()}${note ? `<div class="note-toolbar"><time>${escape(new Date(note.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</time><button type="button" data-note-delete class="productivity-icon-button" aria-label="Delete note">${icon("trash")}</button></div><input data-note-title aria-label="Note title" placeholder="Title" value="${escape(note.title)}"><textarea data-note-body aria-label="Note text" placeholder="Start writing…">${escape(note.body)}</textarea>` : `<div class="productivity-empty">${icon("note")}<h2>Your notes, in one place</h2><p>Capture an idea or keep something for later.</p><button type="button" data-note-new>New Note</button></div>`}</main></section>`;
    renderList();
    content.querySelectorAll("[data-note-new]").forEach((button) => app.listen(button, "click", create));
    app.listen(content.querySelector("input[type=search]"), "input", (event) => { query = event.target.value; renderList(); });
    app.listen(content.querySelector("[data-note-list]"), "click", (event) => { const button = event.target.closest("[data-note-id]"); if (button) { selected = button.dataset.noteId; draw(); } });
    app.listen(content.querySelector("[data-note-title]"), "input", (event) => { update({ title: event.target.value }); windowApi.setTitle(event.target.value || "Notes"); });
    app.listen(content.querySelector("[data-note-body]"), "input", (event) => update({ body: event.target.value }));
    app.listen(content.querySelector("[data-note-delete]"), "click", () => confirmRemoval(content, "Delete this note?", app.signal, () => { app.store.set(app.store.items.filter((item) => item.id !== selected)); selected = app.store.items[0]?.id; draw(); content.querySelector("[data-note-title], [data-note-new]")?.focus(); }));
  };
  draw();
  app.listenPersistent(content, "keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void app.store.flush(); }
    if (event.key.toLowerCase() === "n") { event.preventDefault(); event.stopPropagation(); create(); }
  });
  return app.cleanup;
}

export function renderReminders(os, content, context, windowApi) {
  const app = appSession(os, content, windowApi, "reminders");
  if (!app) return () => {};
  let filter = "all";
  const draw = () => {
    app.beginRender();
    const today = dateKey(new Date());
    const items = app.store.items.filter((item) => filter === "completed" ? item.done : !item.done && (filter !== "today" || item.due === today));
    const incomplete = app.store.items.filter((item) => !item.done).length;
    windowApi.setTitle("Reminders");
    content.innerHTML = `<section class="productivity-app reminders-app"><aside class="productivity-sidebar"><h2>My Lists</h2>${[["all", "Reminders", incomplete], ["today", "Today", app.store.items.filter((item) => !item.done && item.due === today).length], ["completed", "Completed", app.store.items.filter((item) => item.done).length]].map(([value, label, count]) => `<button type="button" data-reminder-filter="${value}" aria-pressed="${filter === value}"><span>${label}</span><strong>${count}</strong></button>`).join("")}</aside><main class="reminder-main">${app.errorMarkup()}<header><h1>${filter === "completed" ? "Completed" : filter === "today" ? "Today" : "Reminders"}</h1><span>${items.length}</span></header><form class="reminder-create"><input name="title" aria-label="New reminder" placeholder="Add a reminder" maxlength="500" required><input name="due" type="date" aria-label="Due date" value="${filter === "today" ? today : ""}"><button type="submit" class="productivity-icon-button" aria-label="Add reminder">${icon("add")}</button></form><ul class="reminder-list">${items.map((item) => `<li><label><input type="checkbox" data-reminder-toggle="${escape(item.id)}" ${item.done ? "checked" : ""} aria-label="Complete ${escape(item.title)}"><span><strong class="${item.done ? "is-complete" : ""}">${escape(item.title)}</strong>${item.due ? `<small class="${item.due < today && !item.done ? "is-overdue" : ""}">${escape(dateLabel(item.due))}</small>` : ""}</span></label><button type="button" class="productivity-icon-button" data-reminder-delete="${escape(item.id)}" aria-label="Delete ${escape(item.title)}">${icon("trash")}</button></li>`).join("")}</ul>${items.length ? "" : `<div class="productivity-empty reminder-empty"><h2>${filter === "completed" ? "Nothing completed yet" : filter === "today" ? "You’re all caught up" : "No reminders"}</h2><p>${filter === "completed" ? "Finished reminders appear here." : "Add something you want to remember."}</p></div>`}</main></section>`;
    app.listen(content.querySelector("form"), "submit", (event) => {
      event.preventDefault(); const data = new FormData(event.target); const title = String(data.get("title") || "").trim();
      if (!title) return;
      app.store.set([...app.store.items, { id: uid(), title, due: String(data.get("due") || ""), done: false }]);
      if (filter === "completed") filter = "all";
      draw(); content.querySelector("[name=title]").focus();
    });
    const focusFilter = () => content.querySelector(`[data-reminder-filter="${filter}"]`)?.focus();
    content.querySelectorAll("[data-reminder-filter]").forEach((button) => app.listen(button, "click", () => { filter = button.dataset.reminderFilter; draw(); focusFilter(); }));
    content.querySelectorAll("[data-reminder-toggle]").forEach((checkbox) => app.listen(checkbox, "change", () => { app.store.set(app.store.items.map((item) => item.id === checkbox.dataset.reminderToggle ? { ...item, done: checkbox.checked } : item)); draw(); focusFilter(); }));
    content.querySelectorAll("[data-reminder-delete]").forEach((button) => app.listen(button, "click", () => confirmRemoval(content, "Delete this reminder?", app.signal, () => { app.store.set(app.store.items.filter((item) => item.id !== button.dataset.reminderDelete)); draw(); focusFilter(); })));
  };
  draw(); return app.cleanup;
}

export function renderCalendar(os, content, context, windowApi) {
  const app = appSession(os, content, windowApi, "calendar");
  if (!app) return () => {};
  const today = dateKey(new Date());
  let selected = today;
  let month = new Date(`${today}T12:00:00`);
  month.setDate(1);
  const openEvent = () => {
    const previous = document.activeElement;
    const backdrop = document.createElement("div"); backdrop.className = "productivity-sheet-backdrop";
    backdrop.innerHTML = `<form class="productivity-sheet" role="dialog" aria-modal="true" aria-label="New event"><h2>New event</h2><label>Title<input name="title" aria-label="Event title" placeholder="Event title" required maxlength="500"></label><label>Date<input name="date" aria-label="Event date" type="date" value="${selected}" required></label><label>Time<input name="time" aria-label="Event time" type="time"></label><footer><button type="button" data-cancel>Cancel</button><button type="submit">Add Event</button></footer></form>`;
    const finish = () => { app.signal.removeEventListener("abort", finish); backdrop.remove(); if (previous?.isConnected) previous.focus(); };
    app.signal.addEventListener("abort", finish, { once: true });
    backdrop.querySelector("[data-cancel]").onclick = finish;
    backdrop.querySelector("form").onsubmit = (event) => {
      event.preventDefault(); const data = new FormData(event.target); const title = String(data.get("title") || "").trim(); const day = String(data.get("date") || "");
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      app.store.set([...app.store.items, { id: uid(), title, date: day, time: String(data.get("time") || "") }]);
      selected = day; month = new Date(`${day.slice(0, 7)}-01T12:00:00`); finish(); draw();
    };
    trapSheet(backdrop, finish); content.append(backdrop); backdrop.querySelector("input").focus();
  };
  const draw = () => {
    app.beginRender();
    const label = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const events = app.store.items.filter((event) => event.date === selected).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    windowApi.setTitle("Calendar");
    content.innerHTML = `<section class="productivity-app calendar-app"><main class="calendar-main">${app.errorMarkup()}<header class="calendar-toolbar"><h1>${escape(label)}</h1><div><button type="button" data-month="-1" class="productivity-icon-button" aria-label="Previous month">${icon("back")}</button><button type="button" data-calendar-today>Today</button><button type="button" data-month="1" class="productivity-icon-button" aria-label="Next month">${icon("next")}</button></div></header><div class="calendar-weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span>${day}</span>`).join("")}</div><div class="calendar-month" role="group" aria-label="${escape(label)}">${Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start); day.setDate(start.getDate() + index); const key = dateKey(day); const count = app.store.items.filter((event) => event.date === key).length;
      return `<button type="button" data-calendar-day="${key}" class="${day.getMonth() !== month.getMonth() ? "is-other-month" : ""} ${key === today ? "is-today" : ""}" aria-pressed="${selected === key}" aria-label="${escape(dateLabel(key))}${count ? `, ${count} events` : ""}"><span>${day.getDate()}</span>${count ? `<i aria-hidden="true"></i>` : ""}</button>`;
    }).join("")}</div></main><aside class="calendar-agenda"><header><div><small>${escape(new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" }))}</small><h2>${escape(new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" }))}</h2></div><button type="button" data-calendar-add class="productivity-icon-button" aria-label="New event">${icon("add")}</button></header><ul>${events.map((event) => `<li><time>${escape(event.time || "All day")}</time><strong>${escape(event.title)}</strong><button type="button" data-event-delete="${escape(event.id)}" class="productivity-icon-button" aria-label="Delete ${escape(event.title)}">${icon("trash")}</button></li>`).join("")}</ul>${events.length ? "" : `<p class="calendar-no-events">No events. Add one to make room for what matters.</p>`}</aside></section>`;
    content.querySelectorAll("[data-month]").forEach((button) => app.listen(button, "click", () => { month = new Date(month.getFullYear(), month.getMonth() + Number(button.dataset.month), 1); draw(); }));
    app.listen(content.querySelector("[data-calendar-today]"), "click", () => { selected = today; month = new Date(`${today.slice(0, 7)}-01T12:00:00`); draw(); });
    content.querySelectorAll("[data-calendar-day]").forEach((button) => app.listen(button, "click", () => { selected = button.dataset.calendarDay; draw(); }));
    app.listen(content.querySelector("[data-calendar-add]"), "click", openEvent);
    content.querySelectorAll("[data-event-delete]").forEach((button) => app.listen(button, "click", () => confirmRemoval(content, "Delete this event?", app.signal, () => { app.store.set(app.store.items.filter((event) => event.id !== button.dataset.eventDelete)); draw(); })));
  };
  draw(); return app.cleanup;
}
