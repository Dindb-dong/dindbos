import { mountAppIcon } from "../app-icon.js";

export function mountRecentApps(shell, { platform }) {
  const { root } = shell;
  const document = root.ownerDocument;
  let dialog, returnFocus, rail;
  let cleanups = [];
  const close = (restoreFocus = true) => {
    if (!dialog) return;
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    dialog.remove();
    dialog = null;
    delete root.dataset.recentApps;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  };
  const closeTask = async (task, card) => {
    if (shell.os.windows.hasVisibleTrustedSurface?.() || card.dataset.closing) return;
    card.dataset.closing = "true";
    try {
      await shell.os.windows.close(task.id);
      if (!shell.os.windows.windows.has(task.id)) {
        const next = card.nextElementSibling || card.previousElementSibling;
        card.remove();
        if (dialog && !rail.children.length) close(false);
        else next?.querySelector("button")?.focus({ preventScroll: true });
      }
    } catch (error) {
      shell.notify?.(error.message || "The app could not be closed.");
    } finally {
      delete card.dataset.closing;
      card.style.transform = "";
      card.style.opacity = "";
    }
  };
  const open = () => {
    if (shell.os.windows.hasVisibleTrustedSurface?.()) return;
    shell.closePanel(false);
    close(false);
    returnFocus = document.activeElement;
    dialog = document.createElement("dialog");
    dialog.className = `dos-recent-apps dos-${platform}-recents`;
    dialog.setAttribute("aria-label", "Recent apps");
    root.dataset.recentApps = "true";
    const header = document.createElement("header");
    header.className = "dos-recents-header";
    const label = document.createElement("h2");
    label.textContent = "Recent apps";
    const done = document.createElement("button");
    done.type = "button";
    done.textContent = "Done";
    done.addEventListener("click", () => close());
    header.append(label, done);
    rail = document.createElement("div");
    rail.className = "dos-recents-rail";
    rail.setAttribute("aria-label", "Running apps");
    const tasks = [...shell.os.windows.windows.values()].filter(task => !task.closing).sort((a, b) => Number(b.frame?.style?.zIndex || 0) - Number(a.frame?.style?.zIndex || 0));
    for (const task of tasks) {
      const card = document.createElement("article");
      card.className = "dos-recent-card";
      card.dataset.recentWindowId = task.id;
      const heading = document.createElement("div");
      heading.className = "dos-recent-heading";
      const icon = document.createElement("span");
      icon.className = "dos-recent-icon";
      const app = shell.os.apps?.list().find(app => app.id === task.appId);
      cleanups.push(mountAppIcon(icon, app?.icon || "app"));
      const title = document.createElement("span");
      title.textContent = task.title || task.appId;
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "dos-recent-close";
      dismiss.setAttribute("aria-label", `Close ${title.textContent}`);
      dismiss.textContent = "×";
      dismiss.addEventListener("click", () => closeTask(task, card));
      heading.append(icon, title, dismiss);
      const preview = document.createElement("button");
      preview.type = "button";
      preview.className = "dos-recent-preview dos-android-recent-task";
      preview.setAttribute("aria-label", title.textContent);
      const snapshot = document.createElement("div");
      snapshot.className = "dos-recent-snapshot";
      snapshot.dataset.mobilePane = task.frame?.dataset.mobilePane || "";
      snapshot.setAttribute("aria-hidden", "true");
      snapshot.inert = true;
      const content = task.content?.cloneNode(true);
      if (content) {
        const sources = [task.content, ...task.content.querySelectorAll("*")];
        const copies = [content, ...content.querySelectorAll("*")];
        copies.forEach((copy, index) => {
          copy.removeAttribute("id");
          copy.removeAttribute("autofocus");
          copy.removeAttribute("name");
          if ("value" in sources[index]) copy.value = sources[index].value;
          if ("checked" in sources[index]) copy.checked = sources[index].checked;
          if (copy.tagName === "CANVAS") {
            try { copy.getContext("2d")?.drawImage(sources[index], 0, 0); } catch { /* A protected canvas remains blank. */ }
          }
        });
        // shortcut: external frames cannot be safely cloned; retain a labeled preview until a capture broker exists.
        content.querySelectorAll("iframe, object, embed, script").forEach(element => {
          const fallback = document.createElement("div");
          fallback.className = "dos-recent-frame-placeholder";
          fallback.textContent = element.tagName === "SCRIPT" ? "" : element.title || "Embedded content";
          element.replaceWith(fallback);
        });
        snapshot.append(content);
        snapshot._scrollPositions = () => copies.forEach((copy, index) => { copy.scrollTop = sources[index].scrollTop; copy.scrollLeft = sources[index].scrollLeft; });
      }
      preview.append(snapshot);
      card.append(heading, preview);
      rail.append(card);
      let gesture, moved = false;
      card.addEventListener("pointerdown", event => {
        if (event.button !== 0 || event.target.closest(".dos-recent-close")) return;
        gesture = { x: event.clientX, y: event.clientY, scroll: rail.scrollLeft, pointer: event.pointerId };
        moved = false;
        (event.target.closest(".dos-recent-preview") || card).setPointerCapture?.(event.pointerId);
      });
      card.addEventListener("pointermove", event => {
        if (!gesture || gesture.pointer !== event.pointerId) return;
        const x = event.clientX - gesture.x, y = event.clientY - gesture.y;
        if (Math.max(Math.abs(x), Math.abs(y)) < 8 && !gesture.axis) return;
        gesture.axis ||= Math.abs(x) > Math.abs(y) ? "x" : "y";
        moved = true;
        if (gesture.axis === "x") { rail.style.scrollSnapType = "none"; rail.scrollLeft = gesture.scroll - x; }
        else { card.style.transform = `translateY(${Math.min(0, y)}px)`; card.style.opacity = String(Math.max(.15, 1 + Math.min(0, y) / 350)); }
      });
      const finish = event => {
        if (!gesture || gesture.pointer !== event.pointerId) return;
        const dismiss = event.type === "pointerup" && gesture.axis === "y" && event.clientY - gesture.y < -80;
        gesture = null;
        if (event.type === "pointercancel") moved = false;
        rail.style.scrollSnapType = "";
        card.style.transform = "";
        card.style.opacity = "";
        if (dismiss) closeTask(task, card);
      };
      card.addEventListener("pointerup", finish);
      card.addEventListener("pointercancel", finish);
      preview.addEventListener("click", event => {
        if (moved) { event.preventDefault(); moved = false; return; }
        if (shell.os.windows.hasVisibleTrustedSurface?.()) return;
        close(false);
        shell.os.windows.restore(task.id);
      });
    }
    dialog.append(header, rail);
    if (!tasks.length) {
      const empty = document.createElement("p");
      empty.className = "dos-recents-empty";
      empty.textContent = "No recent apps";
      dialog.append(empty);
    }
    if (platform === "android" && tasks.length) {
      const all = document.createElement("button");
      all.className = "dos-recents-close-all";
      all.type = "button";
      all.textContent = "Close all";
      all.addEventListener("click", async () => {
        for (const task of tasks) {
          if (!dialog || shell.os.windows.hasVisibleTrustedSurface?.()) break;
          const card = [...rail.children].find(card => card.dataset.recentWindowId === task.id);
          if (card) await closeTask(task, card);
          if (shell.os.windows.windows.has(task.id)) break;
        }
      });
      dialog.append(all);
    }
    dialog.addEventListener("keydown", event => {
      if (shell.os.windows.hasVisibleTrustedSurface?.()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); event.stopPropagation();
        const cards = [...rail.children];
        const current = document.activeElement.closest(".dos-recent-card");
        const next = cards[Math.max(0, Math.min(cards.length - 1, cards.indexOf(current) + (event.key === "ArrowRight" ? 1 : -1)))];
        next?.querySelector(".dos-recent-preview")?.focus();
        next?.scrollIntoView({ inline: "center", block: "nearest", behavior: document.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }
      if (event.key === "Tab") {
        const buttons = [...dialog.querySelectorAll("button")];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    const outside = event => {
      if (!dialog || shell.os.windows.hasVisibleTrustedSurface?.()) return;
      if (event.target === dialog || !root.contains(event.target)) close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    cleanups.push(() => document.removeEventListener("pointerdown", outside, true));
    shell.refs.overlays.append(dialog);
    dialog.show();
    for (const snapshot of rail.querySelectorAll(".dos-recent-snapshot")) {
      const task = shell.os.windows.windows.get(snapshot.closest("[data-recent-window-id]").dataset.recentWindowId);
      const width = task.content.clientWidth || root.clientWidth;
      const height = task.content.clientHeight || Math.max(240, root.clientHeight - 148);
      const preview = snapshot.parentElement;
      const scale = preview.clientWidth / width;
      preview.style.aspectRatio = `${width} / ${height}`;
      Object.assign(snapshot.style, { width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` });
      snapshot._scrollPositions?.();
      delete snapshot._scrollPositions;
    }
    const ResizeObserverType = document.defaultView.ResizeObserver;
    if (ResizeObserverType) {
      const observer = new ResizeObserverType(() => {
        for (const snapshot of rail.querySelectorAll(".dos-recent-snapshot")) snapshot.style.transform = `scale(${snapshot.parentElement.clientWidth / parseFloat(snapshot.style.width)})`;
      });
      observer.observe(rail);
      cleanups.push(() => observer.disconnect());
    }
    (rail.querySelector(".dos-recent-preview") || done).focus({ preventScroll: true });
  };
  return { open, close, get isOpen() { return Boolean(dialog); }, destroy: () => close(false) };
}
