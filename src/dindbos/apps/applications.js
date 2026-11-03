import { mountAppIcon } from "../../ui/app-icon.js";

const GROUPS = [["all", "All"], ["productivity", "Productivity"], ["media", "Media"], ["internet", "Internet"], ["utilities", "Utilities"], ["development", "Development"], ["other", "Other"]];
const CATEGORY = {
  notes: "productivity", reminders: "productivity", calendar: "productivity", text: "productivity",
  photos: "media", music: "media", viewer: "media", browser: "internet",
  files: "utilities", clock: "utilities", calculator: "utilities", settings: "utilities", welcome: "utilities", applications: "utilities",
  terminal: "development", "activity-monitor": "development", portfolio: "other",
};
const escape = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function applicationCategory(app) {
  const category = String(app.category || "").toLowerCase();
  return GROUPS.some(([id]) => id !== "all" && id === category) ? category : CATEGORY[app.id] || "other";
}

/** A registry-backed library: it never invents apps that are not installed. */
export function renderApplications(os, content, context = {}, windowApi = {}) {
  const controller = new AbortController();
  let iconCleanups = [];
  let apps = [];
  let visible = [];
  let category = "all";
  let query = "";
  let selectedId = "";
  let disposed = false;
  const listen = (element, event, handler) => element.addEventListener(event, handler, { signal: controller.signal });
  const clearIcons = () => { for (const cleanup of iconCleanups.splice(0)) cleanup(); };
  windowApi.setTitle?.("Applications");
  content.innerHTML = `<section class="applications-app"><header class="applications-header" data-window-drag><label class="applications-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg><input type="search" aria-label="Search applications" placeholder="Applications" autocomplete="off"></label><span class="applications-header-drag" data-window-drag aria-hidden="true"></span><details class="applications-actions"><summary aria-label="Application actions" title="Application actions">•••</summary><div><button type="button" class="applications-refresh">Refresh applications</button></div></details></header><nav class="applications-categories" role="tablist" aria-label="Application categories"></nav><div class="applications-library"><header class="applications-section-heading"><h2 data-applications-heading>All Applications</h2><span data-applications-count></span></header><div class="applications-grid" role="group" aria-label="Installed applications"></div><div class="applications-empty" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg><h2>No applications found</h2><p>Try another search or category.</p><button type="button" data-applications-clear>Show all applications</button></div></div><footer class="applications-footer"><span data-applications-status role="status" aria-live="polite"></span></footer></section>`;
  const search = content.querySelector("input");
  const tabs = content.querySelector(".applications-categories");
  const grid = content.querySelector(".applications-grid");
  const status = content.querySelector("[data-applications-status]");

  const updateSelection = (id, focus = false) => {
    selectedId = id;
    grid.querySelectorAll("[data-application-id]").forEach((button) => {
      const selected = button.dataset.applicationId === id;
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("is-selected", selected);
      if (focus && selected) button.focus({ preventScroll: true });
    });
  };
  const renderGrid = () => {
    clearIcons();
    const needle = query.trim().toLocaleLowerCase();
    visible = apps.filter((app) => (category === "all" || applicationCategory(app) === category) && `${app.name || app.id} ${app.id}`.toLocaleLowerCase().includes(needle));
    if (!visible.some((app) => app.id === selectedId)) selectedId = visible[0]?.id || "";
    tabs.querySelectorAll("button").forEach((button) => { const selected = button.dataset.applicationCategory === category; button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; });
    content.querySelector("[data-applications-heading]").textContent = needle ? "Search Results" : category === "all" ? "All Applications" : GROUPS.find(([id]) => id === category)?.[1] || "Applications";
    content.querySelector("[data-applications-count]").textContent = `${visible.length} ${visible.length === 1 ? "app" : "apps"}`;
    content.querySelector(".applications-empty").hidden = visible.length !== 0;
    grid.hidden = visible.length === 0;
    grid.innerHTML = visible.map((app) => `<button type="button" class="applications-item${app.id === selectedId ? " is-selected" : ""}" data-application-id="${escape(app.id)}" aria-label="Open ${escape(app.name || app.id)}" title="${escape(app.name || app.id)}" tabindex="${app.id === selectedId ? 0 : -1}"><span class="applications-icon" aria-hidden="true"></span><span class="applications-item-name">${escape(app.name || app.id)}</span></button>`).join("");
    grid.querySelectorAll("[data-application-id]").forEach((button) => {
      const app = visible.find((item) => item.id === button.dataset.applicationId);
      iconCleanups.push(mountAppIcon(button.querySelector(".applications-icon"), app.icon || "app"));
    });
    status.textContent = needle ? `${visible.length} matching ${visible.length === 1 ? "application" : "applications"}` : `${apps.length} installed ${apps.length === 1 ? "application" : "applications"}`;
    status.setAttribute("role", "status");
  };
  const refresh = () => {
    if (disposed) return;
    apps = os.apps.list().filter((app) => app.id !== "applications").sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    const available = GROUPS.filter(([id]) => id === "all" || apps.some((app) => applicationCategory(app) === id));
    if (!available.some(([id]) => id === category)) category = "all";
    tabs.innerHTML = available.map(([id, label]) => `<button type="button" role="tab" data-application-category="${id}" aria-selected="${category === id}">${label}</button>`).join("");
    renderGrid();
  };
  const chooseCategory = (id, focus = false) => { category = id; renderGrid(); if (focus) { const button = tabs.querySelector(`[data-application-category="${id}"]`); button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: "nearest", inline: "nearest" }); } };
  listen(tabs, "click", (event) => { const button = event.target.closest("[data-application-category]"); if (button) chooseCategory(button.dataset.applicationCategory); });
  listen(tabs, "keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...tabs.querySelectorAll("button")];
    const index = buttons.findIndex((button) => button.dataset.applicationCategory === category);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length;
    event.preventDefault(); chooseCategory(buttons[next].dataset.applicationCategory, true);
  });
  listen(search, "input", () => { query = search.value; renderGrid(); });
  listen(content.querySelector(".applications-refresh"), "click", () => { refresh(); content.querySelector(".applications-actions").open = false; });
  listen(content.querySelector("[data-applications-clear]"), "click", () => { query = ""; category = "all"; search.value = ""; renderGrid(); search.focus({ preventScroll: true }); });
  listen(grid, "click", async (event) => {
    const button = event.target.closest("[data-application-id]");
    if (!button) return;
    updateSelection(button.dataset.applicationId);
    try {
      const launch = typeof context.launchApp === "function" ? context.launchApp : (id) => os.launch(id);
      await launch(button.dataset.applicationId);
      if (!disposed) { status.setAttribute("role", "status"); status.textContent = `Opened ${apps.find((app) => app.id === button.dataset.applicationId)?.name || button.dataset.applicationId}`; }
    } catch (error) { if (!disposed) { status.setAttribute("role", "alert"); status.textContent = error.message || "The application could not be opened."; } }
  });
  listen(grid, "keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || !visible.length) return;
    const buttons = [...grid.querySelectorAll("button")];
    const index = Math.max(0, buttons.findIndex((button) => button === event.target));
    const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
    const step = event.key === "ArrowDown" ? columns : event.key === "ArrowUp" ? -columns : event.key === "ArrowLeft" ? -1 : 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + step));
    event.preventDefault(); updateSelection(visible[next].id, true); buttons[next].scrollIntoView({ block: "nearest" });
  });
  listen(content, "keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); search.focus({ preventScroll: true }); search.select(); }
    if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); query = ""; search.value = ""; renderGrid(); search.focus({ preventScroll: true }); }
  });
  refresh();
  return () => { disposed = true; controller.abort(); clearIcons(); };
}
