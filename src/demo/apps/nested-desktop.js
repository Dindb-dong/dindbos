import React, { useState } from "react";
import { DindbOSApp, DindbOSDesktop } from "../../sdk/react.js";

const h = React.createElement;

export const nestedDesktopOptions = {
  storage: { backend: "memory", name: "dindbos-nested" },
  serviceWorker: false,
  bootstrapPackages: false,
  builtins: { includePortfolio: false },
};

export function NestedDesktopApp({ children }) {
  return h(DindbOSApp, {
    id: "nested-desktop",
    name: "Nested DindbOS",
    icon: new URL("./nested-desktop.svg", import.meta.url).href,
    singleton: true,
    width: 960,
    height: 680,
  }, h(NestedDesktop, null, children));
}

function NestedDesktop({ children }) {
  const [failed, setFailed] = useState(false);
  return h("section", {
    "aria-label": "Nested DindbOS session",
    style: { display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 8, height: "100%" },
  },
  h("p", { style: { margin: 0, color: "var(--muted)", fontSize: 13 } },
    "This session resets when you close the window."),
  failed
    ? h("p", { role: "alert" }, "The desktop could not start. Close the window and reopen it to try again.")
    : h(DindbOSDesktop, {
      ...nestedDesktopOptions,
      style: { minHeight: 0 },
      onError: () => setFailed(true),
    }, children));
}
