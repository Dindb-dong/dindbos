const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function renderSearchableSelect({ id, label, placeholder }) {
  return `<div class="dos-searchable-select" data-dos-searchable-select>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
    <input type="search" role="combobox" aria-label="${escape(label)}" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="${escape(id)}" placeholder="${escape(placeholder)}" autocomplete="off">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    <div id="${escape(id)}" class="dos-select-menu dos-searchable-select-menu" role="listbox" aria-label="${escape(label)}" popover="auto"></div>
  </div>`;
}

export function mountSearchableSelect(root, { options, value, query = "", empty, onSearch, onSelect }) {
  const input = root.querySelector("input");
  const menu = root.querySelector("[role=listbox]");
  const lifetime = new AbortController();
  const listen = { signal: lifetime.signal };
  let selected = value;
  let active = 0;
  let matches = [];
  const opened = () => menu.matches(":popover-open");
  const display = () => { input.value = query || options.find(option => option.value === selected)?.label || ""; };
  const position = () => {
    if (!opened()) return;
    const rect = root.getBoundingClientRect();
    menu.style.width = `${Math.min(rect.width, innerWidth - 24)}px`;
    menu.style.maxHeight = `${Math.max(96, Math.min(320, innerHeight - rect.bottom - 24))}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - menu.offsetWidth - 12))}px`;
    menu.style.top = `${Math.max(12, Math.min(rect.bottom + 8, innerHeight - menu.offsetHeight - 12))}px`;
  };
  const highlight = () => {
    const rows = [...menu.querySelectorAll("[role=option]")];
    rows.forEach((row, index) => row.classList.toggle("is-active", index === active));
    if (opened() && rows[active]) {
      input.setAttribute("aria-activedescendant", rows[active].id);
      rows[active].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const render = () => {
    const text = query.trim().toLocaleLowerCase();
    matches = options.filter(option => option.pinned || (option.searchText || option.label).toLocaleLowerCase().includes(text));
    active = Math.max(0, matches.findIndex(option => text ? !option.pinned : option.value === selected));
    menu.innerHTML = matches.length ? matches.map((option, index) => `<button type="button" id="${escape(menu.id)}-option-${index}" class="dos-select-option" role="option" tabindex="-1" aria-selected="${option.value === selected}" data-select-value="${escape(option.value)}"><span>${escape(option.label)}</span></button>`).join("") : "";
    if (!matches.length || (text && matches.every(option => option.pinned))) menu.insertAdjacentHTML("beforeend", `<p class="dos-searchable-select-empty">${escape(empty)}</p>`);
    position();
    highlight();
  };
  const close = () => {
    if (opened()) menu.hidePopover();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    display();
  };
  const open = () => {
    input.value = query;
    if (!opened()) menu.showPopover();
    input.setAttribute("aria-expanded", "true");
    render();
  };
  const select = next => {
    selected = next;
    query = "";
    close();
    render();
    onSelect(next);
  };
  input.addEventListener("focus", open, listen);
  input.addEventListener("click", () => { if (!opened()) open(); }, listen);
  input.addEventListener("input", () => {
    query = input.value;
    render();
    onSearch(query, selected);
    if (!opened()) open();
  }, listen);
  input.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (["ArrowDown", "ArrowUp"].includes(event.key) || (opened() && ["Home", "End"].includes(event.key))) {
      event.preventDefault();
      if (!opened()) open();
      else active = event.key === "Home" ? 0 : event.key === "End" ? matches.length - 1 : (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % Math.max(1, matches.length);
      highlight();
    } else if (event.key === "Enter" && opened() && matches[active]) {
      event.preventDefault();
      select(matches[active].value);
    } else if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") close();
  }, listen);
  menu.addEventListener("click", event => {
    const option = event.target.closest("[data-select-value]");
    if (option) { input.focus({ preventScroll: true }); select(option.dataset.selectValue); }
  }, listen);
  menu.addEventListener("toggle", () => { if (!opened()) close(); }, listen);
  window.addEventListener("resize", position, listen);
  document.addEventListener("scroll", position, { ...listen, capture: true });
  render();
  display();
  return { select, setValue: next => { selected = next; render(); if (!opened()) display(); }, destroy: () => { close(); lifetime.abort(); } };
}
