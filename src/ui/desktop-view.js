import React from "react";
import { createRoot } from "react-dom/client";

const h = React.createElement;

export function createDesktopRenderer(options = {}) {
  if (!isReactRootTarget(options.desktopElement) || !isReactRootTarget(options.dockElement)) {
    return createStaticDesktopRenderer();
  }

  const desktopRoot = createRoot(options.desktopElement);
  const dockRoot = createRoot(options.dockElement);
  const openNode = options.onOpenNode || (() => {});
  const launchApp = options.onLaunchApp || (() => {});
  const isMobile = options.isMobile || (() => false);

  return {
    renderDesktop(entries = []) {
      desktopRoot.render(h(DesktopGrid, { entries, isMobile, openNode }));
    },
    renderDock(apps = []) {
      dockRoot.render(h(DockList, { apps, launchApp }));
    },
    unmount() {
      desktopRoot.unmount();
      dockRoot.unmount();
    },
  };
}

function createStaticDesktopRenderer() {
  return {
    renderDesktop() {},
    renderDock() {},
    unmount() {},
  };
}

function isReactRootTarget(element) {
  return element?.nodeType === 1 || element?.nodeType === 9 || element?.nodeType === 11;
}

function DesktopGrid({ entries, isMobile, openNode }) {
  return entries.map((entry) => h(
    "button",
    {
      key: entry.path || entry.name,
      className: "dos-icon",
      type: "button",
      "data-icon": entry.icon,
      "aria-label": `Open ${entry.name}`,
      onClick: () => {
        if (isMobile()) openNode(entry.node);
      },
      onDoubleClick: () => openNode(entry.node),
    },
    h("span", { className: "dos-icon-art", "aria-hidden": "true" }, h(IconForType, { type: entry.icon })),
    h("span", { className: "dos-icon-label" }, entry.name),
  ));
}

function DockList({ apps, launchApp }) {
  return apps.map((app) => h(
    "button",
    {
      key: app.id,
      className: "dos-dock-item",
      type: "button",
      "data-icon": app.icon || "app",
      "aria-label": `Launch ${app.name}`,
      onClick: () => launchApp(app.id),
    },
    h("span", { className: "dos-dock-glyph", "aria-hidden": "true" }, h(IconForType, { type: app.icon || "app" })),
    h("span", null, app.name),
  ));
}

function IconForType({ type }) {
  const paths = ICON_PATHS[type] || ICON_PATHS.monitor;
  return h(
    "svg",
    {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.8",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      focusable: "false",
      "aria-hidden": "true",
    },
    paths.map((path, index) => h("path", { key: index, d: path })),
  );
}

const ICON_PATHS = {
  activity: ["M22 12h-4l-3 8L9 4l-3 8H2"],
  app: ["M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M8 7h8", "M8 12h3", "M8 16h5"],
  browser: ["M4 5h16v14H4z", "M4 9h16", "M8 7h.01", "M12 7h.01"],
  calculator: ["M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M8 7h8", "M8 12h.01", "M12 12h.01", "M16 12h.01", "M8 16h.01", "M12 16h.01", "M16 16h.01"],
  device: ["M4 5h16v11H4z", "M8 21h8", "M12 16v5"],
  directory: ["M3 6h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"],
  folder: ["M3 6h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  home: ["M3 11 12 3l9 8", "M5 10v10h14V10", "M9 20v-6h6v6"],
  image: ["M4 5h16v14H4z", "M8 13l2.5-2.5L16 16", "M14 10h.01"],
  monitor: ["M4 5h16v11H4z", "M8 21h8", "M12 16v5"],
  pdf: ["M14 2H6a2 2 0 0 0-2 2v16h16V8z", "M14 2v6h6", "M8 15h8", "M8 18h5"],
  portfolio: ["M10 6V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1", "M4 7h16v12H4z", "M4 12h16"],
  settings: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.7 1.7 0 0 0 .34 1.88l.03.03-1.8 3.12-.05-.02a1.7 1.7 0 0 0-1.86-.34 1.7 1.7 0 0 0-1.06 1.58V21h-3v-.06a1.7 1.7 0 0 0-1.06-1.58 1.7 1.7 0 0 0-1.86.34l-.05.02-1.8-3.12.03-.03A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 13.94H3v-3h.06A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.03-.03 1.8-3.12.05.02a1.7 1.7 0 0 0 1.86.34A1.7 1.7 0 0 0 9 2.75V3h6v-.25a1.7 1.7 0 0 0 1.06 1.58 1.7 1.7 0 0 0 1.86-.34l.05-.02 1.8 3.12-.03.03A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1.94h.06v3H21a1.7 1.7 0 0 0-1.6 1.06z"],
  terminal: ["M4 5h16v14H4z", "M8 9l3 3-3 3", "M13 15h4"],
  text: ["M14 2H6a2 2 0 0 0-2 2v16h16V8z", "M14 2v6h6", "M8 13h8", "M8 17h6"],
  trash: ["M3 6h18", "M8 6V4h8v2", "M6 6l1 15h10l1-15"],
};
