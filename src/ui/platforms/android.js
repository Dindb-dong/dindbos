const glyph = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

export function androidHome(shell) {
  if (shell.os.windows.hasVisibleTrustedSurface?.()) return;
  shell.closePanel(false);
  for (const task of shell.os.windows.windows.values()) {
    if (!task.minimized) shell.os.windows.minimize(task.id);
  }
}

export function androidBack(shell) {
  if (shell.os.windows.hasVisibleTrustedSurface?.()) return;
  if (shell.activePanel) return shell.closePanel();
  const task = shell.activeTask();
  if (!task) return;
  const EventType = shell.root.ownerDocument.defaultView.CustomEvent;
  // shortcut: apps opt into Back via a cancelable event; otherwise preserve state at Home.
  const handled = task.content && !task.content.dispatchEvent(new EventType("dindbos:back", { bubbles: true, cancelable: true }));
  if (!handled) androidHome(shell);
}

export function mountAndroidShell(shell) {
  const { root, refs } = shell;
  const document = root.ownerDocument;
  const navigation = document.createElement("nav");
  navigation.className = "dos-android-navigation";
  navigation.setAttribute("aria-label", "System navigation");
  navigation.innerHTML = `
    <button type="button" data-android-action="recents" aria-label="Recent apps" aria-haspopup="dialog">${glyph('<path d="M7 6v12M12 6v12M17 6v12"/>')}</button>
    <button type="button" data-android-action="home" aria-label="Home">${glyph('<rect x="5" y="5" width="14" height="14" rx="5"/>')}</button>
    <button type="button" data-android-action="back" aria-label="Back">${glyph('<path d="m15 5-7 7 7 7"/>')}</button>`;
  const heading = document.createElement("section");
  heading.className = "dos-android-heading";
  const title = document.createElement("h1");
  title.textContent = "Your workspace";
  const subtitle = document.createElement("p");
  subtitle.textContent = "Everything in reach.";
  heading.append(title, subtitle);
  const actions = document.createElement("div");
  actions.className = "dos-android-home-actions";
  actions.innerHTML = `<button type="button" data-shell-panel="launcher" aria-haspopup="dialog" aria-expanded="false">${glyph('<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>')}<span>Apps</span></button><button type="button" data-shell-panel="controls" aria-haspopup="dialog" aria-expanded="false">${glyph('<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>')}<span>Quick settings</span></button>`;
  refs.shell.append(heading, actions, navigation);
  let recentDialog;
  let recentReturnFocus;
  const closeRecents = (restoreFocus = true) => {
    if (!recentDialog) return;
    recentDialog.close();
    recentDialog.remove();
    recentDialog = null;
    if (restoreFocus && recentReturnFocus?.isConnected) recentReturnFocus.focus({ preventScroll: true });
    recentReturnFocus = null;
  };
  const openRecents = () => {
    if (shell.os.windows.hasVisibleTrustedSurface?.()) return;
    shell.closePanel(false);
    closeRecents(false);
    recentReturnFocus = document.activeElement;
    const dialog = document.createElement("dialog");
    recentDialog = dialog;
    dialog.className = "dos-android-recents";
    dialog.setAttribute("aria-label", "Recent apps");
    const header = document.createElement("header");
    const label = document.createElement("h2");
    label.textContent = "Recent apps";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Done";
    dismiss.addEventListener("click", () => closeRecents());
    header.append(label, dismiss);
    dialog.append(header);
    const tasks = [...shell.os.windows.windows.values()].sort((a, b) => Number(b.frame?.style?.zIndex || 0) - Number(a.frame?.style?.zIndex || 0));
    for (const task of tasks) {
      const button = document.createElement("button");
      button.className = "dos-android-recent-task";
      button.type = "button";
      button.textContent = task.title || task.appId;
      button.addEventListener("click", () => { closeRecents(false); shell.os.windows.restore(task.id); });
      dialog.append(button);
    }
    if (!tasks.length) {
      const empty = document.createElement("p");
      empty.textContent = "No recent apps";
      dialog.append(empty);
    }
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRecents(); }
      if (event.key === "Tab") {
        const buttons = [...dialog.querySelectorAll("button")];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    dialog.addEventListener("close", () => { dialog.remove(); if (recentDialog === dialog) recentDialog = null; });
    refs.overlays.append(dialog);
    dialog.show();
    dismiss.focus({ preventScroll: true });
  };
  const click = (event) => {
    if (shell.os.windows.hasVisibleTrustedSurface?.()) return;
    const action = event.target.closest("[data-android-action]")?.dataset.androidAction;
    if (action === "home") { closeRecents(false); androidHome(shell); }
    else if (action === "back") { if (recentDialog) closeRecents(); else androidBack(shell); }
    else if (action === "recents") openRecents();
  };
  const outside = (event) => { if (recentDialog && !recentDialog.contains(event.target) && !navigation.contains(event.target)) closeRecents(false); };
  document.addEventListener("pointerdown", outside, true);
  navigation.addEventListener("click", click);
  return () => {
    closeRecents(false);
    document.removeEventListener("pointerdown", outside, true);
    navigation.removeEventListener("click", click);
    navigation.remove();
    heading.remove();
    actions.remove();
  };
}
