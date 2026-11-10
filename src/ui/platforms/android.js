import { mountRecentApps } from "./recent-apps.js";

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
  const actions = document.createElement("div");
  actions.className = "dos-android-home-actions";
  actions.innerHTML = `<button type="button" data-shell-panel="launcher" aria-label="Search applications" aria-haspopup="dialog" aria-expanded="false">${glyph('<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>')}<span>Search apps</span></button>`;
  refs.shell.append(actions, navigation);
  const recents = mountRecentApps(shell, { platform: "android" });
  const click = (event) => {
    if (shell.os.windows.hasVisibleTrustedSurface?.()) return;
    const action = event.target.closest("[data-android-action]")?.dataset.androidAction;
    if (action === "home") { recents.close(false); androidHome(shell); }
    else if (action === "back") { if (recents.isOpen) recents.close(); else androidBack(shell); }
    else if (action === "recents") recents.open();
  };
  navigation.addEventListener("click", click);
  return () => {
    recents.destroy();
    navigation.removeEventListener("click", click);
    navigation.remove();
    actions.remove();
  };
}
