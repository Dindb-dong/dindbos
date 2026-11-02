import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dockMagnification } from "../src/ui/desktop-view.js";
import { AppIcon, isImageIcon } from "../src/ui/app-icon.js";

assert.equal(dockMagnification(0), 1);
assert.equal(dockMagnification(140), 0);
assert.equal(dockMagnification(-200), 0);
assert.equal(dockMagnification(-50), dockMagnification(50));
assert(dockMagnification(25) > dockMagnification(75));
assert(isImageIcon("/my-icon.svg"));
assert(isImageIcon("https://example.com/icon.png"));
assert(!isImageIcon("javascript:alert(1)"));
assert(!isImageIcon("settings"));
const icons = ["welcome", "files", "folder", "browser", "terminal", "calculator", "activity", "settings", "portfolio", "text", "file", "pdf", "image", "trash", "home", "unknown"];
for (const icon of icons) {
  const markup = renderToStaticMarkup(React.createElement(AppIcon, { icon }));
  assert(markup.includes("<svg"), `${icon} has an SVG fallback`);
  assert(markup.includes('aria-hidden="true"'));
  assert(!markup.includes("undefined"));
}
const custom = renderToStaticMarkup(React.createElement(AppIcon, { icon: React.createElement("svg", { "data-custom": "yes" }) }));
assert(custom.includes('data-custom="yes"'));
const image = renderToStaticMarkup(React.createElement(AppIcon, { icon: "/brand.svg" }));
assert(image.includes('src="/brand.svg"'));
const blocked = renderToStaticMarkup(React.createElement(AppIcon, { icon: "javascript:alert(1)" }));
assert(!blocked.includes("javascript:"));
console.log("desktop UI smoke passed: Dock falloff, safe custom icons, all built-in artwork");
