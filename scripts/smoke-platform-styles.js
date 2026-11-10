import assert from "node:assert/strict";
import { normalizeDindbOSHostConfig, publicHostConfig } from "../src/sdk/host-config.js";
import { resolveUIStyle } from "../src/dindbos/ui-style.js";

assert.equal(normalizeDindbOSHostConfig().ui.style, "macos");
for (const style of ["macos", "windows", "ios", "android"]) {
  const config = normalizeDindbOSHostConfig({ ui: { style } });
  assert.equal(publicHostConfig(config).ui.style, style);
  assert.equal(resolveUIStyle(config.ui, 390), style);
  assert.equal(resolveUIStyle(config.ui, 760), style);
  assert.equal(resolveUIStyle(config.ui, 761), ["ios", "android"].includes(style) ? "macos" : style);
}
assert.equal(resolveUIStyle({ style: "windows", mobileStyle: "ios" }, 390), "ios");
assert.equal(resolveUIStyle({ style: "windows", mobileStyle: "ios" }, 1280), "windows");
assert.equal(resolveUIStyle({ style: "macos", mobileStyle: "android" }, 760), "android");
assert.equal(resolveUIStyle({ style: "ios" }, 0), "macos");
for (const style of ["linux", "", 42, {}, false]) assert.throws(() => normalizeDindbOSHostConfig({ ui: { style } }), /ui.style/);
for (const mobileStyle of ["macos", "windows", null, 1]) assert.throws(() => normalizeDindbOSHostConfig({ ui: { mobileStyle } }), /ui.mobileStyle/);
console.log("platform style configuration passed: defaults, validation, public snapshot, container boundaries");
