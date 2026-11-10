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
    swipe = { x: event.clientX, y: event.clientY, pointer: event.pointerId, began: Date.now(), lastMove: Date.now(), frame: shell.os.windows.windows.get(shell.os.windows.activeWindowId)?.frame, hadApp: [...shell.os.windows.windows.values()].some(task => !task.minimized) };
    suppressClick = false;
    home.setPointerCapture?.(event.pointerId);
  };
  const clearSwipe = (gesture) => {
    gesture.frame?.style.removeProperty("--mobile-swipe-transform");
    delete shell.root.dataset.homeGesture;
  };
  const moveSwipe = event => {
    if (!swipe || swipe.pointer !== event.pointerId || shell.os.windows.hasVisibleTrustedSurface?.()) return;
    const distance = Math.max(0, swipe.y - event.clientY);
    swipe.lastMove = Date.now();
    if (swipe.frame && !document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      shell.root.dataset.homeGesture = "true";
      const progress = Math.min(.4, distance / Math.max(400, shell.root.clientHeight));
      swipe.frame.style.setProperty("--mobile-swipe-transform", `translateY(${-distance * .35}px) scale(${1 - progress * .45})`);
    }
  };
  const endSwipe = event => {
    if (!swipe || swipe.pointer !== event.pointerId) return;
    const gesture = swipe;
    swipe = null;
    delete shell.root.dataset.homeGesture;
    if (event.type !== "pointerup" || gesture.y - event.clientY < 35 || Math.abs(gesture.x - event.clientX) > 100) { clearSwipe(gesture); return; }
    suppressClick = true;
    const paused = Date.now() - gesture.lastMove >= 120;
    if (gesture.hadApp && !paused) {
      showHome();
      // Let the window manager install its minimizing state before clearing direct manipulation.
      document.defaultView?.requestAnimationFrame(() => clearSwipe(gesture));
    } else { recents.open(); clearSwipe(gesture); }
  };
  const activateHome = () => { if (suppressClick) suppressClick = false; else showHome(); };
  home.addEventListener("click", activateHome);
  home.addEventListener("pointerdown", startSwipe);
  home.addEventListener("pointermove", moveSwipe);
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
    if (swipe) clearSwipe(swipe);
    home.removeEventListener("click", activateHome);
    home.removeEventListener("pointerdown", startSwipe);
    home.removeEventListener("pointermove", moveSwipe);
    home.removeEventListener("pointerup", endSwipe);
    home.removeEventListener("pointercancel", endSwipe);
    home.remove();
    search?.remove();
  };
}
