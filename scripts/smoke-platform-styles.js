import assert from "node:assert/strict";
import { normalizeDindbOSHostConfig, publicHostConfig } from "../src/sdk/host-config.js";
import { detectVisitorOS, resolveUIStyle } from "../src/dindbos/ui-style.js";

assert.equal(normalizeDindbOSHostConfig().ui.style, "auto");
for (const style of ["macos", "windows", "ios", "android"]) {
  const config = normalizeDindbOSHostConfig({ ui: { style } });
  assert.equal(publicHostConfig(config).ui.style, style);
  assert.equal(resolveUIStyle(config.ui, 390), style);
  assert.equal(resolveUIStyle(config.ui, 760), style);
  assert.equal(resolveUIStyle(config.ui, 761), style);
}
assert.equal(resolveUIStyle({ style: "windows", mobileStyle: "ios" }, 390), "ios");
assert.equal(resolveUIStyle({ style: "windows", mobileStyle: "ios" }, 1280), "windows");
assert.equal(resolveUIStyle({ style: "macos", mobileStyle: "android" }, 760), "android");
assert.equal(resolveUIStyle({ style: "ios" }, 0), "ios");
for (const style of ["linux", "", 42, {}, false]) assert.throws(() => normalizeDindbOSHostConfig({ ui: { style } }), /ui.style/);
for (const mobileStyle of ['linux', null, 1]) assert.throws(() => normalizeDindbOSHostConfig({ ui: { mobileStyle } }), /ui.mobileStyle/);
const visitors = {
  macos: { platform: 'MacIntel', userAgent: 'Mozilla/5.0 Macintosh' },
  windows: { platform: 'Win32', userAgent: 'Mozilla/5.0 Windows NT 10.0' },
  android: { platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 Linux; Android 16' },
  ios: { platform: 'iPhone', userAgent: 'Mozilla/5.0 iPhone; CPU iPhone OS' },
  other: { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 X11' },
};
const pairs = { macos: ['windows', 'android'], windows: ['macos', 'ios'], android: ['macos', 'ios'], ios: ['windows', 'android'], other: ['macos', 'macos'] };
for (const [os, navigator] of Object.entries(visitors)) {
  assert.equal(detectVisitorOS(navigator), os);
  assert.equal(resolveUIStyle({}, 1280, 900, navigator), pairs[os][0]);
  assert.equal(resolveUIStyle({}, 390, 844, navigator), pairs[os][1]);
  if (['ios', 'android'].includes(os)) assert.equal(resolveUIStyle({}, 740, 390, navigator), pairs[os][0], 'landscape selects desktop even below760px');
}
assert.equal(detectVisitorOS({ platform: 'MacIntel', maxTouchPoints: 5, userAgent: 'Macintosh' }), 'ios', 'desktop-mode iPad');
assert.equal(detectVisitorOS({ userAgentData: { platform: 'Windows' } }), 'windows');
assert.equal(detectVisitorOS(null), 'other', 'SSR/unknown fallback');
const customized = normalizeDindbOSHostConfig({ ui: { autoStyles: { macos: { desktop: 'macos' }, ios: { mobile: 'ios', desktop: 'android' } } } });
assert.equal(resolveUIStyle(customized.ui, 1280, 900, visitors.macos), 'macos');
assert.equal(resolveUIStyle(customized.ui, 390, 844, visitors.macos), 'android', 'partial rules retain defaults');
assert.equal(resolveUIStyle(customized.ui, 390, 844, visitors.ios), 'ios');
assert.equal(resolveUIStyle(customized.ui, 740, 390, visitors.ios), 'android');
const snapshot = publicHostConfig(customized);
assert.deepEqual(snapshot.ui.autoStyles.ios, { desktop: 'android', mobile: 'ios' });
snapshot.ui.autoStyles.ios.mobile = 'windows';
assert.equal(customized.ui.autoStyles.ios.mobile, 'ios', 'snapshot does not mutate active configuration');
assert.equal(normalizeDindbOSHostConfig().ui.autoStyles.macos.desktop, 'windows', 'defaults are independent');
for (const autoStyles of [null, [], 1, { linux: {} }, { macos: null }, { ios: { mobile: 'auto' } }, { other: { portrait: 'macos' } }]) assert.throws(() => normalizeDindbOSHostConfig({ ui: { autoStyles } }), /ui.autoStyles/);
console.log("platform style configuration passed: visitor defaults, rotation, overrides, partial maps, SSR, validation and public snapshot isolation");
