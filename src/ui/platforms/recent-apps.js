import { mountAppIcon } from "../app-icon.js";

export function mountRecentApps(shell, { platform }) {
  const { root } = shell;
  const document = root.ownerDocument;
  let dialog, returnFocus, rail;
  let cleanups = [];
  let settleFrame;
  const animations = new Set();
  const reducedMotion = () => document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const motion = async (element, frames, duration = 320) => {
    if (reducedMotion() || !element?.animate) return;
    const animation = element.animate(frames, { duration, easing: "cubic-bezier(.22,.8,.25,1)", fill: "forwards" });
    animations.add(animation);
    try { await animation.finished; } catch { /* Interrupted navigation cancels its own motion. */ }
    finally { animations.delete(animation); animation.cancel(); }
  };
  const perspective = () => {
    if (!rail) return;
    for (const card of rail.children) {
      const distance = Math.min(1, Math.abs(card.offsetLeft + card.offsetWidth / 2 - rail.scrollLeft - rail.clientWidth / 2) / rail.clientWidth);
      card.style.setProperty("--recent-scale", reducedMotion() ? "1" : String(1 - distance * .09));
    }
  };
  const settle = (destination) => {
    document.defaultView.cancelAnimationFrame(settleFrame);
    const targetRail = rail;
    const start = targetRail.scrollLeft;
    const target = Math.max(0, Math.min(targetRail.scrollWidth - targetRail.clientWidth, destination));
    if (reducedMotion()) { targetRail.scrollLeft = target; perspective(); return; }
    const began = document.defaultView.performance.now();
    const step = now => {
      const progress = Math.min(1, (now - began) / 360);
      targetRail.scrollLeft = start + (target - start) * (1 - Math.pow(1 - progress, 4));
      perspective();
      if (progress < 1 && targetRail.isConnected) settleFrame = document.defaultView.requestAnimationFrame(step);
      else targetRail.style.scrollSnapType = "";
    };
    targetRail.style.scrollSnapType = "none";
    settleFrame = document.defaultView.requestAnimationFrame(step);
  };
  const center = card => card.offsetLeft + card.offsetWidth / 2 - rail.clientWidth / 2;
  const close = (restoreFocus = true) => {
    document.defaultView?.cancelAnimationFrame?.(settleFrame);
    for (const animation of animations) animation.cancel();
    animations.clear();
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
    const owner = dialog;
    const from = card.style.transform || "translateY(0px)";
    try {
      await shell.os.windows.close(task.id);
      if (!card.isConnected || dialog !== owner) {
        if (dialog && !shell.os.windows.windows.has(task.id)) {
          [...rail.children].find(item => item.dataset.recentWindowId === task.id)?.remove();
          if (!rail.children.length) close(false);
        }
        return;
      }
      if (!shell.os.windows.windows.has(task.id)) {
        await motion(card, [{ transform: from, opacity: 1 }, { transform: `translateY(${-root.clientHeight}px)`, opacity: 0 }], 240);
        if (!card.isConnected || dialog !== owner) return;
        const next = card.nextElementSibling || card.previousElementSibling;
        card.remove();
        if (!rail.children.length) close(false);
        else { settle(center(next)); next?.querySelector(".dos-recent-preview")?.focus({ preventScroll: true }); }
      } else await motion(card, [{ transform: from }, { transform: "translateY(0px)" }]);
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
    const sourceTask = shell.os.windows.windows.get(shell.os.windows.activeWindowId);
    const sourceBounds = sourceTask && !sourceTask.minimized ? sourceTask.frame.getBoundingClientRect() : null;
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
      title.textContent = app?.name || task.title || task.appId;
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "dos-recent-close";
      dismiss.setAttribute("aria-label", `Close ${task.title || task.appId}`);
      dismiss.textContent = "×";
      dismiss.addEventListener("click", () => closeTask(task, card));
      heading.append(icon, title, dismiss);
      const preview = document.createElement("button");
      preview.type = "button";
      preview.className = "dos-recent-preview dos-android-recent-task";
      preview.setAttribute("aria-label", task.title || task.appId);
      const snapshot = document.createElement("div");
      snapshot.className = "dos-recent-snapshot";
      snapshot.style.containerName = document.defaultView.getComputedStyle(task.frame).containerName;
      snapshot.dataset.mobilePane = task.frame?.dataset.mobilePane || "";
      snapshot.setAttribute("aria-hidden", "true");
      snapshot.inert = true;
      const content = task.content?.cloneNode(true);
      if (content) {
        const contentStyle = document.defaultView.getComputedStyle(task.content);
        content.style.containerName = contentStyle.containerName;
        content.style.containerType = contentStyle.containerType;
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
        if (card.dataset.closing || shell.os.windows.hasVisibleTrustedSurface?.()) return;
        document.defaultView.cancelAnimationFrame(settleFrame);
        for (const animation of card.getAnimations()) animation.cancel();
        gesture = { x: event.clientX, y: event.clientY, scroll: rail.scrollLeft, pointer: event.pointerId, lastX: event.clientX, lastTime: event.timeStamp, velocity: 0 };
        rail.style.scrollSnapType = "none";
        moved = false;
        (event.target.closest(".dos-recent-preview") || card).setPointerCapture?.(event.pointerId);
      });
      card.addEventListener("pointermove", event => {
        if (!gesture || gesture.pointer !== event.pointerId) return;
        const x = event.clientX - gesture.x, y = event.clientY - gesture.y;
        if (Math.max(Math.abs(x), Math.abs(y)) < 8 && !gesture.axis) return;
        gesture.axis ||= Math.abs(x) > Math.abs(y) ? "x" : "y";
        moved = true;
        const elapsed = event.timeStamp - gesture.lastTime;
        if (elapsed > 0) gesture.velocity = (event.clientX - gesture.lastX) / elapsed;
        gesture.lastX = event.clientX; gesture.lastTime = event.timeStamp;
        if (gesture.axis === "x") { rail.style.scrollSnapType = "none"; rail.scrollLeft = gesture.scroll - x; perspective(); }
        else { card.style.transform = `translateY(${Math.min(0, y)}px)`; card.style.opacity = String(Math.max(.15, 1 + Math.min(0, y) / 350)); }
      });
      const finish = event => {
        if (!gesture || gesture.pointer !== event.pointerId) return;
        const { axis, velocity } = gesture;
        const dismiss = event.type === "pointerup" && axis === "y" && event.clientY - gesture.y < -80;
        gesture = null;
        if (event.type === "pointercancel") moved = false;
        if (axis === "x") {
          const projected = rail.scrollLeft - (event.type === "pointerup" ? Math.max(-2, Math.min(2, velocity)) * 100 : 0);
          const nearest = [...rail.children].reduce((best, item) => Math.abs(center(item) - projected) < Math.abs(center(best) - projected) ? item : best);
          settle(center(nearest));
        } else if (dismiss) closeTask(task, card);
        else {
          const from = card.style.transform || "translateY(0px)";
          card.style.transform = ""; card.style.opacity = "";
          motion(card, [{ transform: from }, { transform: "translateY(0px)" }]);
          rail.style.scrollSnapType = "";
        }
      };
      card.addEventListener("pointerup", finish);
      card.addEventListener("pointercancel", finish);
      preview.addEventListener("click", event => {
        if (moved) { event.preventDefault(); moved = false; return; }
        if (shell.os.windows.hasVisibleTrustedSurface?.()) return;
        const from = preview.getBoundingClientRect();
        close(false);
        shell.os.windows.restore(task.id);
        shell.os.windows.focus(task.id);
        const to = task.frame.getBoundingClientRect();
        motion(task.frame, [
          { transformOrigin: "top left", transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, borderRadius: "26px" },
          { transformOrigin: "top left", transform: "translate(0px, 0px) scale(1)", borderRadius: "0px" },
        ], 380);
      });
    }
    dialog.append(header, rail);
    rail.addEventListener("scroll", perspective, { passive: true });
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
        const owner = dialog;
        for (const task of tasks) {
          if (!dialog || dialog !== owner || shell.os.windows.hasVisibleTrustedSurface?.()) break;
          const card = [...rail.children].find(card => card.dataset.recentWindowId === task.id);
          if (card) await closeTask(task, card);
          if (dialog !== owner || shell.os.windows.windows.has(task.id)) break;
        }
      });
      dialog.append(all);
    }
    if (platform === "android") {
      const suggestions = document.createElement("nav");
      suggestions.className = "dos-recents-suggestions";
      suggestions.setAttribute("aria-label", "Suggested apps");
      for (const app of (shell.os.apps?.list() || []).filter(app => app.pinned).slice(0, 4)) {
        const button = document.createElement("button"); button.type = "button";
        button.setAttribute("aria-label", `Open ${app.name}`);
        cleanups.push(mountAppIcon(button, app.icon || "app"));
        button.addEventListener("click", () => { close(false); shell.launchApp(app.id); });
        suggestions.append(button);
      }
      dialog.append(suggestions);
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
        if (next) settle(center(next));
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
    const fitSnapshot = snapshot => {
      const preview = snapshot.parentElement;
      const width = parseFloat(snapshot.style.width), height = parseFloat(snapshot.style.height);
      const availableHeight = preview.parentElement.clientHeight - preview.previousElementSibling.offsetHeight;
      preview.style.transition = "none";
      preview.style.maxWidth = `${Math.max(0, availableHeight) * width / height}px`;
      preview.style.alignSelf = "center";
      snapshot.style.transform = `scale(${parseFloat(document.defaultView.getComputedStyle(preview).width) / width})`;
    };
    for (const snapshot of rail.querySelectorAll(".dos-recent-snapshot")) {
      const task = shell.os.windows.windows.get(snapshot.closest("[data-recent-window-id]").dataset.recentWindowId);
      const width = task.content.clientWidth || root.clientWidth;
      const height = task.content.clientHeight || Math.max(240, root.clientHeight - 148);
      const preview = snapshot.parentElement;
      preview.style.aspectRatio = `${width} / ${height}`;
      Object.assign(snapshot.style, { width: `${width}px`, height: `${height}px` });
      fitSnapshot(snapshot);
      snapshot._scrollPositions?.();
      delete snapshot._scrollPositions;
    }
    const ResizeObserverType = document.defaultView.ResizeObserver;
    if (ResizeObserverType) {
      const observer = new ResizeObserverType(() => {
        for (const snapshot of rail.querySelectorAll(".dos-recent-snapshot")) fitSnapshot(snapshot);
      });
      observer.observe(rail);
      cleanups.push(() => observer.disconnect());
    }
    perspective();
    motion(dialog, [{ opacity: 0 }, { opacity: 1 }], 220);
    for (const [index, card] of [...rail.children].entries()) {
      const preview = card.querySelector(".dos-recent-preview");
      const bounds = preview.getBoundingClientRect();
      const origin = index === 0 && sourceBounds
        ? `translate(${sourceBounds.left - bounds.left}px, ${sourceBounds.top - bounds.top}px) scale(${sourceBounds.width / bounds.width}, ${sourceBounds.height / bounds.height})`
        : "translateY(64px) scale(.92)";
      motion(preview, [{ transformOrigin: "top left", transform: origin, opacity: .6 }, { transformOrigin: "top left", transform: "none", opacity: 1 }], 380);
    }
    (rail.querySelector(".dos-recent-preview") || done).focus({ preventScroll: true });
  };
  return { open, close, get isOpen() { return Boolean(dialog); }, destroy: () => close(false) };
}
