import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DindbOSDesktop, DindbOSApp, useDindbOSApp } from "./sdk/react.js";
import { demoFileSystem, portfolioData } from "./demo/portfolio-demo.js";

const h = React.createElement;
const launch = new URLSearchParams(window.location.search).get("qa") === "fresh" ? ["welcome", "files"] : ["welcome"];

function Counter() {
  const [count, setCount] = useState(0);
  const { window: appWindow } = useDindbOSApp();
  return h("section", { className: "demo-counter" },
    h("h1", null, "Your component. Its own window."),
    h("p", null, "This is a React component running inside DindbOS. Its state stays with the window when you minimize it."),
    h("output", { "aria-label": "Count" }, count),
    h("div", { className: "demo-counter-actions" },
      h("button", { onClick: () => setCount((value) => value - 1), "aria-label": "Decrease count" }, "−"),
      h("button", { onClick: () => setCount((value) => value + 1), "aria-label": "Increase count" }, "+"),
      h("button", { onClick: () => appWindow.minimize() }, "Minimize")),
    h("pre", null, `<DindbOSApp id="counter" name="My App">\n  <YourComponent />\n</DindbOSApp>`));
}

createRoot(document.querySelector("#dindbos-root")).render(
  h(DindbOSDesktop, {
    style: { width: "100%", height: "100%" },
    fileSystem: demoFileSystem,
    session: { user: "guest", product: "DindbOS" },
    storage: { name: "dindbos-showcase" },
    builtins: { portfolioData, includeWelcome: true },
    installApps(os) {
      const pinned = new Set(["files", "terminal", "browser", "calculator", "settings"]);
      for (const app of os.apps.list()) os.registerApp({ ...app, desktop: false, pinned: pinned.has(app.id) });
    },
    serviceWorker: false,
    launch,
  }, h(DindbOSApp, { id: "counter", name: "My App", icon: "app", pinned: true, desktop: true, singleton: true, width: 540, height: 440 }, h(Counter))),
);
