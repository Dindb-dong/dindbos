import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppIcon } from "../src/ui/app-icon.js";

const types = ["portfolio", "files", "applications", "terminal", "activity", "text", "browser", "pdf", "calculator", "settings", "notes", "reminders", "calendar", "clock", "photos", "music", "folder", "directory", "file", "image", "home", "trash", "app", "welcome"];
for (const icon of types) {
  const artwork = new Set();
  for (const uiStyle of ["macos", "windows", "ios", "android"]) {
    const markup = renderToStaticMarkup(React.createElement(AppIcon, { icon, uiStyle }));
    assert(markup.includes(`data-icon-style="${uiStyle}"`), `${uiStyle}/${icon} has its own artwork`);
    assert(markup.includes('aria-hidden="true"'), "decorative icons do not duplicate the app name");
    assert(markup.includes('viewBox="0 0 64 64"'));
    assert(!markup.includes("undefined"));
    artwork.add(markup.replace(/data-icon-style="[^"]+"/g, ""));
  }
  assert.equal(artwork.size, 4, `${icon} must have four distinct platform variants`);
}
for (const uiStyle of ["windows", "ios", "android"]) {
  for (const icon of ["constructor", "toString", "__proto__"]) {
    const markup = renderToStaticMarkup(React.createElement(AppIcon, { icon, uiStyle }));
    assert(markup.includes("<svg"), "prototype-named icons safely use the fallback artwork");
    assert(!markup.includes("[native code]"));
  }
  const image = renderToStaticMarkup(React.createElement(AppIcon, { icon: "/custom-brand.svg", uiStyle }));
  assert(image.includes('src="/custom-brand.svg"'), "host-provided image icons remain intact");
  assert(!image.includes("data-icon-style"));
  const custom = renderToStaticMarkup(React.createElement(AppIcon, { icon: React.createElement("svg", { "data-custom-icon": "host" }), uiStyle }));
  assert(custom.includes('data-custom-icon="host"'), "host React icon artwork remains intact");
  const unsafe = renderToStaticMarkup(React.createElement(AppIcon, { icon: "<img src=x onerror=alert(1)>", uiStyle }));
  assert(!unsafe.includes("onerror"), "unrecognized icon names never become SVG markup");
}
console.log("platform icons passed: all builtin and generic artwork, distinct platform variants, decorative semantics, host overrides, unsafe names");
