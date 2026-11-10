import { mountRecentApps } from "./recent-apps.js";

export function mountIOSShell(shell) {
  const document = shell.root.ownerDocument;
  const home = document.createElement("button");
  home.type = "button";
  home.className = "dos-ios-home";
  home.setAttribute("aria-label", "Home");
  home.innerHTML = '<span aria-hidden="true"></span>';
  const recents = mountRecentApps(shell, { platform: "ios" });
  const showHome = () => {
    if (shell.os.windows.hasVisibleTrustedSurface?.()) return;
    recents.close(false);
    shell.closePanel(false);
    for (const task of shell.os.windows.windows.values()) {
      if (!task.minimized) shell.os.windows.minimize(task.id);
    }
    home.focus({ preventScroll: true });
  };
  let swipe;
  let suppressClick = false;
  const startSwipe = event => {
    if (event.button !== 0 || shell.os.windows.hasVisibleTrustedSurface?.()) return;
    swipe = { x: event.clientX, y: event.clientY, pointer: event.pointerId, began: Date.now(), hadApp: [...shell.os.windows.windows.values()].some(task => !task.minimized) };
    suppressClick = false;
    home.setPointerCapture?.(event.pointerId);
  };
  const endSwipe = event => {
    if (!swipe || swipe.pointer !== event.pointerId) return;
    const gesture = swipe;
    swipe = null;
    if (event.type !== "pointerup" || gesture.y - event.clientY < 35 || Math.abs(gesture.x - event.clientX) > 100) return;
    suppressClick = true;
    if (gesture.hadApp && Date.now() - gesture.began < 500) showHome();
    else recents.open();
  };
  const activateHome = () => { if (suppressClick) suppressClick = false; else showHome(); };
  home.addEventListener("click", activateHome);
  home.addEventListener("pointerdown", startSwipe);
  home.addEventListener("pointerup", endSwipe);
  home.addEventListener("pointercancel", endSwipe);
  shell.refs.shell.appendChild(home);

  let search;
  if (!shell.os.uiOptions?.slots?.desktop) {
    search = document.createElement("button");
    search.type = "button";
    search.className = "dos-ios-search";
    search.dataset.shellPanel = "launcher";
    search.setAttribute("aria-haspopup", "dialog");
    search.setAttribute("aria-expanded", "false");
    search.textContent = "Search";
    shell.refs.shell.appendChild(search);
  }
  return () => {
    recents.destroy();
    home.removeEventListener("click", activateHome);
    home.removeEventListener("pointerdown", startSwipe);
    home.removeEventListener("pointerup", endSwipe);
    home.removeEventListener("pointercancel", endSwipe);
    home.remove();
    search?.remove();
  };
}
