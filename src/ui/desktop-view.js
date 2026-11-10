import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { AppIcon } from "./app-icon.js";

const h = React.createElement;

export function createDesktopRenderer(options = {}) {
  if (!isReactRootTarget(options.desktopElement) || !isReactRootTarget(options.dockElement)) {
    return { renderDesktop() {}, renderDock() {}, unmount() {} };
  }
  const desktopRoot = createRoot(options.desktopElement);
  const dockRoot = createRoot(options.dockElement);
  let unmounted = false;
  return {
    renderDesktop(entries = []) {
      if (!unmounted) desktopRoot.render(h(DesktopGrid, { key: options.getStyle?.(), entries: options.getStyle?.() === "ios" ? groupMobileHomeEntries(entries) : entries, overlayElement: options.overlayElement, hasTrustedSurface: options.hasTrustedSurface, isMobile: options.isMobile || (() => false), openNode: options.onOpenNode || (() => {}), onSelectNode: options.onSelectNode }));
    },
    renderDock(apps = [], dockApps = [], appStates = {}) {
      if (!unmounted) dockRoot.render(h(DockList, { apps: options.getStyle?.() === "ios" ? apps.slice(0, 4) : apps, dockApps: options.getStyle?.() === "ios" ? [] : dockApps, appStates, element: options.dockElement, launchApp: options.onLaunchApp || (() => {}) }));
    },
    unmount() {
      if (unmounted) return;
      unmounted = true;
      const errors = [];
      for (const root of [desktopRoot, dockRoot]) {
        try { root.unmount(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "Desktop renderers failed to unmount");
    },
  };
}

function isReactRootTarget(element) {
  return element?.nodeType === 1 || element?.nodeType === 9 || element?.nodeType === 11;
}

export function groupMobileHomeEntries(entries) {
  // shortcut: legacy experience-* IDs group career apps; use category for new hosts.
  const children = entries.filter((entry) => ["career", "experience"].includes(entry.category) || entry.appId?.startsWith("experience-"));
  if (children.length < 2) return entries;
  const grouped = new Set(children);
  const folder = { name: "Experience", kind: "app-folder", children };
  return entries.flatMap((entry) => entry === children[0] ? [folder] : grouped.has(entry) ? [] : [entry]);
}

function DesktopGrid({ entries, isMobile, openNode, onSelectNode, overlayElement, hasTrustedSurface }) {
  const [selected, setSelected] = useState(null);
  const [folder, setFolder] = useState(null);
  const select = (entry) => { setSelected(entry.path || entry.name); onSelectNode?.(entry.node); };
  return [entries.map((entry, index) => h("button", {
    key: entry.path || entry.name,
    className: `dos-icon${selected === (entry.path || entry.name) ? " is-selected" : ""}`,
    type: "button", "data-icon": typeof entry.icon === "string" ? entry.icon : "custom",
    "data-desktop-path": entry.path,
    "data-desktop-app-id": entry.appId || undefined,
    "data-desktop-kind": entry.kind,
    draggable: !entry.children,
    "aria-haspopup": entry.children ? "dialog" : undefined,
    "aria-expanded": entry.children ? folder === entry : undefined,
    onDragStart: (event) => {
      if (entry.children) return event.preventDefault();
      event.dataTransfer.setData("application/x-dindbos-path", entry.path);
      event.dataTransfer.effectAllowed = "copyMove";
    },
    "aria-label": `Open ${entry.name}`, "aria-pressed": selected === (entry.path || entry.name),
    onPointerDown: () => select(entry),
    onClick: (event) => {
      select(entry);
      if (entry.children) { if (!hasTrustedSurface?.()) setFolder(entry); return; }
      // Keyboard-generated clicks have detail=0; pointer desktop clicks select.
      if (event.detail === 0 || event.nativeEvent.pointerType === "touch" || isMobile()) openNode(entry.node);
    },
    onDoubleClick: () => { if (!entry.children && !isMobile()) openNode(entry.node); },
    onKeyDown: (event) => {
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const delta = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1;
      const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, index + delta));
      event.currentTarget.parentElement?.querySelectorAll(".dos-icon")[next]?.focus();
      select(entries[next]);
    },
  }, h("span", { className: entry.children ? "dos-icon-art dos-folder-preview" : "dos-icon-art", "aria-hidden": true }, entry.children ? entry.children.slice(0, 4).map((child) => h(AppIcon, { key: child.appId, icon: child.icon })) : h(AppIcon, { icon: entry.icon })), h("span", { className: "dos-icon-label" }, entry.name))),
    folder && overlayElement ? createPortal(h(HomeFolder, { key: folder.name, folder, openNode, hasTrustedSurface, close: () => setFolder(null) }), overlayElement) : null,
  ];
}

function HomeFolder({ folder, openNode, close, hasTrustedSurface }) {
  const panel = useRef(null);
  const backdrop = useRef(null);
  const restoreFocus = useRef(true);
  const dismiss = useRef(() => close());
  useEffect(() => {
    const element = panel.current;
    const shade = backdrop.current;
    const document = element.ownerDocument;
    const trigger = document.activeElement;
    const source = trigger?.querySelector?.(".dos-icon-art")?.getBoundingClientRect();
    const destination = element.getBoundingClientRect();
    const reduced = document.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const origin = !reduced && source ? `translate(${source.left - destination.left}px, ${source.top - destination.top}px) scale(${source.width / destination.width}, ${source.height / destination.height})` : "none";
    const animations = [];
    let closing = false;
    const animate = (target, frames, duration, easing) => {
      const animation = target.animate(frames, { duration: reduced ? 0 : duration, easing, fill: "both" });
      animations.push(animation);
      return animation;
    };
    animate(element, [{ transform: origin, opacity: 0 }, { transform: "none", opacity: 1 }], 360, "cubic-bezier(.22,.8,.25,1)");
    animate(shade, [{ opacity: 0 }, { opacity: 1 }], 260, "ease-out");
    dismiss.current = (after) => {
      if (closing) return;
      closing = true;
      const current = document.defaultView.getComputedStyle(element);
      animate(element, [{ transform: current.transform, opacity: current.opacity }, { transform: origin, opacity: 0 }], 240, "cubic-bezier(.4,0,.7,.3)");
      const exit = animate(shade, [{ opacity: document.defaultView.getComputedStyle(shade).opacity }, { opacity: 0 }], 240, "ease-in");
      exit.finished.then(() => { if (element.isConnected) { close(); if (!hasTrustedSurface?.()) after?.(); } }).catch(() => {});
    };
    element.querySelector("button")?.focus({ preventScroll: true });
    const outside = (event) => { if (!element.contains(event.target)) { restoreFocus.current = false; dismiss.current(); } };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      animations.forEach((animation) => animation.cancel());
      if (restoreFocus.current && !hasTrustedSurface?.() && trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return h("div", { className: "dos-home-folder-backdrop", ref: backdrop }, h("section", {
    className: "dos-home-folder", ref: panel, role: "dialog", "aria-modal": "true", "aria-label": folder.name,
    onKeyDown: (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss.current(); }
      if (event.key === "Tab") {
        const buttons = [...panel.current.querySelectorAll("button")];
        const index = buttons.indexOf(event.currentTarget.ownerDocument.activeElement);
        if (event.shiftKey && index === 0) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && index === buttons.length - 1) { event.preventDefault(); buttons[0]?.focus(); }
      }
    },
  }, h("header", null, h("h2", null, folder.name), h("button", { type: "button", "aria-label": "Close folder", onClick: () => dismiss.current() }, "×")),
  h("div", { className: "dos-home-folder-grid" }, folder.children.map((entry) => h("button", {
    type: "button", className: "dos-icon", key: entry.path || entry.appId, "aria-label": `Open ${entry.name}`, "data-folder-app-id": entry.appId,
    onClick: () => { restoreFocus.current = false; dismiss.current(() => openNode(entry.node)); },
  }, h("span", { className: "dos-icon-art", "aria-hidden": true }, h(AppIcon, { icon: entry.icon })), h("span", { className: "dos-icon-label" }, entry.name))))));
}

export function dockMagnification(distance, radius = 140) {
  const normalized = Math.min(1, Math.max(0, Math.abs(distance) / radius));
  return (1 + Math.cos(normalized * Math.PI)) / 2;
}

function DockList({ apps, dockApps, appStates, launchApp, element }) {
  useEffect(() => {
    let frame = null;
    let pointerX = null;
    const reset = () => {
      pointerX = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      element.querySelectorAll(".dos-dock-item").forEach((item) => item.style.removeProperty("--dock-proximity"));
    };
    const move = (event) => {
      if (element.closest(".dindbos-host")?.dataset.uiStyle !== "macos" || element.dataset.contextOpen || event.pointerType === "touch" || element.closest(".dindbos-host")?.clientWidth <= 500 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return reset();
      pointerX = event.clientX;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (element.dataset.contextOpen) return reset();
        if (pointerX === null) return;
        const updates = [...element.querySelectorAll(".dos-dock-item")].map((item) => {
          const rect = item.getBoundingClientRect();
          return [item, dockMagnification(pointerX - (rect.left + rect.width / 2)).toFixed(3)];
        });
        for (const [item, value] of updates) {
          if (item.style.getPropertyValue("--dock-proximity") !== value) item.style.setProperty("--dock-proximity", value);
        }
      });
    };
    const keyboard = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const items = [...element.querySelectorAll(".dos-dock-item")];
      const index = items.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", reset);
    element.addEventListener("keydown", keyboard);
    return () => { reset(); element.removeEventListener("pointermove", move); element.removeEventListener("pointerleave", reset); element.removeEventListener("keydown", keyboard); };
  }, [element]);
  return [
    ...apps.map((app) => h(DockItem, { key: app.id, app, state: appStates[app.id] || {}, launchApp })),
    ...(dockApps.length ? [h("span", { key: "separator", className: "dos-dock-separator", "aria-hidden": true })] : []),
    ...dockApps.map((app) => h(DockItem, { key: `window:${app.windowId || app.id}`, app, state: app, launchApp, transient: true })),
  ];
}

function DockItem({ app, state, launchApp, transient = false }) {
  const [launching, setLaunching] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const name = (typeof app.title === "string" && app.title) || app.name || app.id;
  return h("button", {
    type: "button",
    className: ["dos-dock-item", state.running && "is-running", state.minimized && "is-minimized", state.active && "is-active", transient && "dos-dock-window", launching && "is-launching"].filter(Boolean).join(" "),
    "data-icon": typeof app.icon === "string" ? app.icon : "custom", "data-dock-app-id": app.id,
    "data-minimized-window-id": transient ? app.windowId : undefined,
    "aria-label": state.minimized ? `Restore ${name}` : state.running ? `Focus ${name}` : `Launch ${app.name || app.id}`,
    onClick: () => {
      if (!state.running) { setLaunching(true); clearTimeout(timer.current); timer.current = setTimeout(() => setLaunching(false), 650); }
      launchApp(app.id);
    },
  }, h("span", { className: "dos-dock-glyph", "aria-hidden": true }, h(AppIcon, { icon: app.icon || "app" })), h("span", { className: "dos-dock-tooltip", "aria-hidden": true }, app.name || name));
}
