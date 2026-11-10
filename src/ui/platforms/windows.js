const START_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>';

export function mountWindowsShell(shell) {
  const { root, refs, os } = shell;
  const document = root.ownerDocument;
  const taskbar = document.createElement("nav");
  taskbar.className = "dos-windows-taskbar";
  taskbar.setAttribute("aria-label", "Taskbar");
  taskbar.innerHTML = `<details class="dos-windows-app-menus"><summary>App menus</summary></details><div class="dos-windows-taskbar-apps"><button type="button" class="dos-windows-start" data-shell-panel="launcher" aria-label="Start" aria-haspopup="dialog" aria-expanded="false">${START_ICON}</button></div><div class="dos-windows-tray"></div>`;
  const details = taskbar.querySelector("details");
  const center = taskbar.querySelector(".dos-windows-taskbar-apps");
  const tray = taskbar.querySelector(".dos-windows-tray");
  const status = refs.menubar.querySelector(".dos-menu-status");
  const placements = [refs.menubar, refs.dock, status].filter(Boolean).map(element => [element, element.parentNode, element.nextSibling]);
  details.append(refs.menubar);
  center.append(refs.dock);
  if (status) tray.append(status);
  refs.shell.append(taskbar);
  const owns = event => event.target?.closest?.(".dindbos-host") === root;
  const dismiss = event => {
    if (!details.contains(event.target) && !refs.overlays.contains(event.target)) details.open = false;
  };
  const keyboard = event => {
    if (!owns(event) || event.defaultPrevented || os.windows?.hasVisibleTrustedSurface?.()) return;
    if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      const start = taskbar.querySelector(".dos-windows-start");
      if (shell.activePanel === "launcher") shell.closePanel();
      else shell.openPanel("launcher", start);
    } else if (event.key === "Escape" && details.open && !shell.activePanel) {
      details.open = false;
      details.querySelector("summary").focus();
    }
  };
  const minimize = event => {
    if (!owns(event) || os.windows?.hasVisibleTrustedSurface?.()) return;
    const item = event.target.closest?.(".dos-dock-item:not(.is-minimized)");
    const active = os.windows?.windows?.get(os.windows.activeWindowId);
    if (!item || !active || item.dataset.dockAppId !== active.appId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    shell.closePanel(false);
    os.windows.minimize(active.id);
  };
  document.addEventListener("pointerdown", dismiss);
  root.addEventListener("keydown", keyboard, true);
  refs.dock.addEventListener("click", minimize, true);
  return () => {
    document.removeEventListener("pointerdown", dismiss);
    root.removeEventListener("keydown", keyboard, true);
    refs.dock.removeEventListener("click", minimize, true);
    for (const [element, parent, next] of placements.reverse()) parent.insertBefore(element, next?.parentNode === parent ? next : null);
    taskbar.remove();
  };
}
