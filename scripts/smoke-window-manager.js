#!/usr/bin/env node
import {
  WindowManager,
  constrainWindowRect,
  isMobileWindowViewport,
  mobileWindowPlacement,
  nextFocusWindowId,
  readWindowPlacements,
  restoreWindowPlacement,
  snapWindowRect,
  snapZoneForPoint,
  windowPlacementsPath,
  writeWindowPlacements,
} from "../src/dindbos/window-manager.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const offscreen = constrainWindowRect(
  { left: 1400, top: 900, width: 640, height: 480 },
  { width: 800, height: 600 },
);
assert(offscreen.left <= 680, "offscreen window left was not clamped");
assert(offscreen.top <= 520, "offscreen window top was not clamped");
assert(offscreen.width === 640, "normal window width changed unexpectedly");
assert(offscreen.height === 480, "normal window height changed unexpectedly");

const tooLarge = constrainWindowRect(
  { left: -300, top: -200, width: 2000, height: 1400 },
  { width: 390, height: 640 },
);
assert(tooLarge.left === 8, "negative left was not clamped to margin");
assert(tooLarge.top === 58, "negative top was not clamped to titlebar margin");
assert(tooLarge.width === 374, `oversized width was not reduced: ${tooLarge.width}`);
assert(tooLarge.height === 574, `oversized height was not reduced: ${tooLarge.height}`);

const tinyViewport = constrainWindowRect(
  { left: 500, top: 500, width: 340, height: 240 },
  { width: 220, height: 180 },
);
assert(tinyViewport.width === 204, "tiny viewport width fallback mismatch");
assert(tinyViewport.height === 160, "tiny viewport height fallback mismatch");
assert(tinyViewport.left >= 8, "tiny viewport left became unreachable");
assert(tinyViewport.top >= 58, "tiny viewport top became unreachable");

assert(isMobileWindowViewport({ width: 390, height: 640 }), "mobile viewport was not detected");
assert(!isMobileWindowViewport({ width: 900, height: 700 }), "desktop viewport was misdetected as mobile");
const mobilePlacement = mobileWindowPlacement({ width: 390, height: 640 });
assert(mobilePlacement.left === 10 && mobilePlacement.top === 70, "mobile placement origin mismatch");
assert(mobilePlacement.width === 370, `mobile placement width mismatch: ${mobilePlacement.width}`);
assert(mobilePlacement.height === 478, `mobile placement height mismatch: ${mobilePlacement.height}`);
assert(mobilePlacement.maximized === true, "mobile placement was not maximized");

assert(snapZoneForPoint({ x: 2, y: 300 }, { width: 900, height: 700 }) === "left", "left snap zone mismatch");
assert(snapZoneForPoint({ x: 890, y: 300 }, { width: 900, height: 700 }) === "right", "right snap zone mismatch");
assert(snapZoneForPoint({ x: 400, y: 3 }, { width: 900, height: 700 }) === "top", "top snap zone mismatch");
const leftSnap = snapWindowRect("left", { width: 900, height: 700 });
assert(leftSnap.left === 8 && leftSnap.top === 58, "left snap origin mismatch");
assert(leftSnap.width === 442 && leftSnap.height === 626, `left snap size mismatch: ${JSON.stringify(leftSnap)}`);
const rightSnap = snapWindowRect("right", { width: 900, height: 700 });
assert(rightSnap.left === 450 && rightSnap.width === 442, `right snap mismatch: ${JSON.stringify(rightSnap)}`);

const restored = restoreWindowPlacement(
  { left: 9000, top: 9000, width: 480, height: 360, maximized: true },
  { left: 40, top: 80, width: 500, height: 380, maximized: false },
  { width: 900, height: 700 },
);
assert(restored.left <= 780 && restored.top <= 620, "restored placement was not clamped into viewport");
assert(restored.maximized === true, "restored placement lost maximized state");

const os = bootOs();
writeWindowPlacements(os, {
  browser: { left: 44, top: 88, width: 640, height: 420, maximized: false },
});
const placements = readWindowPlacements(os);
assert(placements.browser.width === 640, "window placement was not written to VFS");
assert(os.fs.exists("/var/lib/dindbos/window-placements/guest.json"), "per-user window placement file was not created");
assert(windowPlacementsPath(os) === "/var/lib/dindbos/window-placements/guest.json", "window placement path did not use session user");
const guestPlacements = JSON.stringify(readWindowPlacements(os));
os.session = { user: "ada-lovelace", groups: ["users"], home: "/home/ada-lovelace" };
assert(Object.keys(readWindowPlacements(os)).length === 0, "window placements leaked across users");
writeWindowPlacements(os, {
  terminal: { left: 32, top: 72, width: 500, height: 360, maximized: true },
});
assert(os.fs.exists("/var/lib/dindbos/window-placements/ada-lovelace.json"), "second user's window placement file was not created");
assert(readWindowPlacements(os).terminal.maximized === true, "second user's window placement was not restored");
os.session = { user: "guest", groups: ["users"], home: "/home/guest" };
assert(JSON.stringify(readWindowPlacements(os)) === guestPlacements, "guest window placements changed after second user wrote layout");

assert(nextFocusWindowId(["one", "two", "three"], "one", 1) === "two", "next focus mismatch");
assert(nextFocusWindowId(["one", "two", "three"], "one", -1) === "three", "previous focus mismatch");
assert(nextFocusWindowId(["one"], "one", 1) === "one", "single focus mismatch");

const manager = new WindowManager({
  processes: {
    updateWindowState: () => {},
  },
});
manager.windows.set("one", fakeTask("one"));
manager.windows.set("two", fakeTask("two"));
manager.activeWindowId = "one";
assert(manager.cycleFocus(1) === "two", "manager alt-tab focus mismatch");
assert(manager.activeWindowId === "two", "manager active id did not update");
const zAfterTwo = Number(manager.windows.get("two").frame.style.zIndex);
manager.focus("one");
assert(Number(manager.windows.get("one").frame.style.zIndex) > zAfterTwo, "focused window did not receive higher z-index");
assert(manager.windows.get("one").frame.classList.active === true, "focused window was not marked active");
assert(manager.windows.get("two").frame.classList.active === false, "previous focused window stayed active");
let prevented = false;
manager.handleGlobalKeyDown({ altKey: true, key: "Tab", preventDefault: () => { prevented = true; } });
assert(prevented, "alt-tab shortcut did not prevent default");
assert(manager.activeWindowId === "two", "alt-tab shortcut did not cycle focus");
manager.handleGlobalKeyDown({ ctrlKey: true, key: "m", preventDefault: () => {} });
assert(manager.windows.get("two").minimized === true, "ctrl-m did not minimize active window");
manager.handleGlobalKeyDown({ ctrlKey: true, key: "w", preventDefault: () => {} });
assert(!manager.windows.has("two"), "ctrl-w did not close active window");

function bootOs() {
  const permissions = new PermissionPolicy();
  return {
    permissions,
    session: { user: "guest", groups: ["users"], home: "/home/guest" },
    fs: new VirtualFileSystem(null, { home: "/home/guest", policy: permissions }),
    clipboard: createTestClipboard(),
  };
}

function createTestClipboard() {
  let text = "";
  return {
    readText: () => text,
    writeText: (value = "") => {
      text = String(value);
      return { bytes: new TextEncoder().encode(text).byteLength };
    },
  };
}

function fakeTask(id) {
  const classList = {
    active: false,
    values: new Set(),
    add: (name) => {
      classList.values.add(name);
    },
    remove: (name) => {
      classList.values.delete(name);
    },
    contains: (name) => classList.values.has(name),
    toggle: (_name, active) => {
      classList.active = active;
    },
  };
  return {
    pid: id,
    title: id,
    frame: {
      hidden: false,
      style: {},
      remove: () => {},
      classList,
    },
  };
}

function installFakeDom() {
  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createDocumentFragment: () => new FakeElement("fragment"),
    exitedPointerLock: false,
    exitPointerLock() {
      this.exitedPointerLock = true;
    },
  };
}

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.textContent = "";
    this.className = "";
    this.listeners = {};
    this.capturedPointerIds = new Set();
    this.releasedPointerIds = [];
    this.classList = {
      values: new Set(),
      add: (name) => {
        this.classList.values.add(name);
      },
      remove: (name) => {
        this.classList.values.delete(name);
      },
      toggle: (name, active) => {
        if (active) this.classList.values.add(name);
        else this.classList.values.delete(name);
      },
      contains: (name) => this.classList.values.has(name),
    };
    this.controls = new Map();
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
  }

  remove() {
    this.removed = true;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  setPointerCapture(pointerId) {
    this.capturedPointerIds.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointerIds.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.capturedPointerIds.delete(pointerId);
    this.releasedPointerIds.push(pointerId);
  }

  querySelector(selector) {
    if (selector === "strong") return this.control(selector);
    if (selector.startsWith("[data-window-")) return this.control(selector);
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-resize]") return [];
    return [];
  }

  getBoundingClientRect() {
    return {
      left: Number.parseFloat(this.style.left) || 0,
      top: Number.parseFloat(this.style.top) || 0,
      width: Number.parseFloat(this.style.width) || 640,
      height: Number.parseFloat(this.style.height) || 420,
    };
  }

  control(selector) {
    if (!this.controls.has(selector)) this.controls.set(selector, new FakeElement("control"));
    return this.controls.get(selector);
  }
}

await runLiveWindowStateSmoke();

console.log("window manager smoke ok viewport snap shortcuts compositor");

async function runLiveWindowStateSmoke() {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  try {
    installFakeDom();
    const liveOs = bootOs();
    liveOs.processes = {
      markReady: () => {},
      updateWindowState: () => {},
    };
    const liveManager = new WindowManager(liveOs);
    liveOs.windows = liveManager;
    const layer = new FakeElement("div");
    const taskStrip = new FakeElement("nav");
    liveManager.mount(layer, taskStrip);
    const api = liveManager.open({
      id: "browser",
      appId: "browser",
      pid: 42,
      title: "Browser.app",
      width: 640,
      height: 420,
      manifest: { capabilities: [] },
      render: (_content, windowApi) => {
        _content.textContent = "Browser surface body";
        windowApi.setState("browser", { address: "https://example.com", title: "Example Domain", status: "ready" });
        windowApi.setTitle("Example Domain - Browser");
      },
    });
    liveManager.minimize("browser");
    const task = liveManager.windows.get("browser");
    assert(task.frame.hidden === false, "window was hidden before minimize animation could run");
    assert(task.frame.classList.contains("is-minimizing"), "window did not enter minimizing animation state");
    await new Promise((resolve) => setTimeout(resolve, 190));
    assert(task.frame.hidden === true, "window was not hidden after minimize animation");
    assert(!task.frame.classList.contains("is-minimizing"), "window kept minimizing class after animation");
    liveManager.focus("browser");
    assert(api.getState("browser").address === "https://example.com", "window API state was not preserved after minimize/focus");
    assert(task.frame.hidden === false, "focus did not reveal minimized window");
    assert(!task.frame.classList.contains("is-minimizing"), "focus did not cancel minimizing animation state");
    const input = liveManager.recordInputEvent("pointerdown", { clientX: 22, clientY: 44, pointerType: "mouse", button: 0 });
    assert(input.windowId === "browser", "compositor input did not bind to focused window");
    const compositor = liveManager.compositorStatus();
    assert(compositor.activeWindowId === "browser" && compositor.focusedPid === 42, "compositor status did not expose focused surface");
    assert(compositor.surfaceCount === 1 && compositor.surfaces[0].rect.width === 640, "compositor status did not expose surface geometry");
    const procCompositor = JSON.parse(liveOs.fs.readFile("/proc/compositor"));
    assert(procCompositor.lastInputEvent.type === "pointerdown", "/proc/compositor did not expose last input event");
    const imeRoute = liveManager.routeInputEvent("compositionupdate", { data: "한" });
    assert(imeRoute.handled && imeRoute.targetPid === 42, "compositor input router did not route IME event to focused window");
    const dropRoute = liveManager.routeInputEvent("drop", { clientX: 80, clientY: 90 });
    assert(dropRoute.handled && dropRoute.targetWindowId === "browser", "compositor input router did not route drop event");
    const routedCompositor = JSON.parse(liveOs.fs.readFile("/proc/compositor"));
    assert(routedCompositor.inputRouter.routed >= 2 && routedCompositor.inputRouter.lastRoute.type === "drop", "/proc/compositor did not expose input router state");
    task.shortcuts = [
      { key: "ctrl+s", scope: "focused", command: "save-document" },
      { key: "ctrl+b", scope: "text-entry", command: "bold-text" },
      { key: "ctrl+shift+p", scope: "global", command: "command-palette" },
    ];
    let shortcutPrevented = false;
    const shortcutRoute = liveManager.routeShortcutEvent({ ctrlKey: true, key: "s", preventDefault: () => { shortcutPrevented = true; } });
    assert(shortcutRoute.handled && shortcutRoute.command === "save-document" && shortcutPrevented, "focused shortcut scope did not route");
    const deniedTextRoute = liveManager.routeShortcutEvent({ ctrlKey: true, key: "s", target: { tagName: "INPUT" } });
    assert(!deniedTextRoute.handled && deniedTextRoute.deniedReason === "text-entry-reserved", "focused shortcut leaked into text entry");
    const textRoute = liveManager.routeShortcutEvent({ ctrlKey: true, key: "b", target: { tagName: "TEXTAREA" }, preventDefault: () => {} });
    assert(textRoute.handled && textRoute.scope === "text-entry", "text-entry shortcut scope did not route");
    const globalRoute = liveManager.routeShortcutEvent({ ctrlKey: true, shiftKey: true, key: "p", target: { tagName: "INPUT" }, preventDefault: () => {} });
    assert(globalRoute.handled && globalRoute.scope === "global", "global shortcut scope did not route from text entry");
    assert(JSON.parse(liveOs.fs.readFile("/proc/compositor")).shortcutRouter.routed >= 3, "/proc/compositor did not expose shortcut router state");
    const copyRoute = liveManager.routeClipboardEvent("copy", { target: { tagName: "TEXTAREA" } }, { text: "copied text" });
    assert(copyRoute.handled && copyRoute.bytes === 11 && liveOs.clipboard.readText() === "copied text", "compositor clipboard copy policy did not write runtime clipboard");
    const pasteRoute = liveManager.routeClipboardEvent("paste", { target: { tagName: "INPUT" } });
    assert(pasteRoute.handled && pasteRoute.textEntry && pasteRoute.bytes === 11, "compositor clipboard paste policy did not route to text entry");
    liveManager.activeWindowId = "";
    const deniedPaste = liveManager.routeClipboardEvent("paste", {}, { requireContent: true });
    assert(!deniedPaste.handled && deniedPaste.deniedReason === "no-focused-window", "compositor clipboard paste did not deny missing focused window");
    liveManager.activeWindowId = "browser";
    const clipboardStatus = JSON.parse(liveOs.fs.readFile("/proc/compositor")).clipboardRouter;
    assert(clipboardStatus.copied === 1 && clipboardStatus.pasted === 1 && clipboardStatus.denied >= 1, "/proc/compositor did not expose clipboard router state");
    const axTree = api.setAccessibilityTree({
      role: "window",
      name: "Browser",
      focus: true,
      actions: ["focus", "close"],
      children: [
        { role: "textbox", name: "Address", value: "https://example.com", state: { focused: true } },
        { role: "button", name: "Reload", actions: ["click"] },
      ],
    });
    assert(axTree.children.length === 2 && api.getAccessibilityTree().children[0].role === "textbox", "window accessibility tree was not stored");
    const axSurface = JSON.parse(liveOs.fs.readFile("/proc/compositor")).surfaces.find((surface) => surface.windowId === "browser");
    assert(axSurface.accessibility.name === "Browser" && axSurface.accessibility.nodeCount === 3, "/proc/compositor did not expose accessibility summary");
    const ownCapture = api.captureSurface();
    assert(ownCapture.handled && ownCapture.scope === "window" && ownCapture.format === "metadata+dom-text", "own-window surface capture did not return a descriptor");
    assert(ownCapture.surfaces[0].text.includes("Browser surface body") && ownCapture.pixelDataAvailable === false, "surface capture descriptor overclaimed or missed window text");
    const deniedDesktopCapture = api.captureDesktop({ userApproved: true });
    assert(!deniedDesktopCapture.handled && deniedDesktopCapture.deniedReason === "capability-denied", "desktop capture without capability was not denied");
    liveManager.open({
      id: "settings",
      appId: "settings",
      pid: 43,
      title: "Settings",
      width: 500,
      height: 360,
      manifest: { capabilities: [] },
      render: (content) => {
        content.textContent = "Settings surface body";
      },
    });
    const recorderApi = liveManager.open({
      id: "recorder",
      appId: "recorder",
      pid: 44,
      title: "Recorder",
      width: 480,
      height: 320,
      manifest: { capabilities: ["compositor.captureWindow", "compositor.captureDesktop"] },
      render: (content) => {
        content.textContent = "Recorder surface body";
      },
    });
    liveManager.focus("browser");
    const deniedCrossCapture = api.captureSurface({ targetWindowId: "settings", userApproved: true });
    assert(!deniedCrossCapture.handled && deniedCrossCapture.deniedReason === "capability-denied", "cross-app surface capture without capability was not denied");
    const desktopCapture = recorderApi.captureDesktop({ userApproved: true });
    assert(desktopCapture.handled && desktopCapture.scope === "desktop" && desktopCapture.surfaces.length >= 3, "capability-approved desktop capture did not include visible surfaces");
    const captureStatus = JSON.parse(liveOs.fs.readFile("/proc/compositor")).surfaceCapture;
    assert(captureStatus.captured === 2 && captureStatus.denied >= 2, "/proc/compositor did not expose surface capture policy state");
    const lockTarget = { locked: false, requestPointerLock() { this.locked = true; } };
    const lockResult = liveManager.requestPointerLock("browser", { target: lockTarget });
    assert(lockResult.handled && lockTarget.locked, "focused window pointer-lock request did not route");
    const deniedLock = liveManager.requestPointerLock("missing-window");
    assert(!deniedLock.handled && deniedLock.deniedReason === "window-not-found", "missing pointer-lock target was not denied");
    assert(JSON.parse(liveOs.fs.readFile("/proc/compositor")).pointerLock.activeWindowId === "browser", "/proc/compositor did not expose active pointer lock");
    task.titlebar.listeners.pointerdown({
      pointerId: 7,
      clientX: 10,
      clientY: 10,
      target: { closest: () => null },
    });
    assert(liveManager.compositorStatus().captureOwner === "browser", "compositor did not record pointer capture owner");
    const processRelease = liveManager.releaseProcessCapture(42, "process-suspend");
    assert(processRelease?.pointerCapture && processRelease?.pointerLock, "process capture cleanup did not release pointer capture and pointer lock");
    assert(task.titlebar.releasedPointerIds.includes(7), "process capture cleanup did not release active pointer capture");
    const suspendedCompositor = JSON.parse(liveOs.fs.readFile("/proc/compositor"));
    assert(suspendedCompositor.captureOwner === "", "suspended process kept pointer capture owner");
    assert(suspendedCompositor.pointerLock.activeWindowId === "" && suspendedCompositor.pointerLock.releaseReason === "process-suspend", "suspended process kept pointer lock owner");
    globalThis.document.exitedPointerLock = false;
    liveManager.requestPointerLock("browser", { target: lockTarget });
    task.titlebar.listeners.pointerdown({
      pointerId: 8,
      clientX: 10,
      clientY: 10,
      target: { closest: () => null },
    });
    liveManager.close("browser");
    assert(globalThis.document.exitedPointerLock === true, "window close did not exit active pointer lock");
    assert(task.titlebar.releasedPointerIds.includes(8), "window close did not release active pointer capture");
    const closeCompositor = JSON.parse(liveOs.fs.readFile("/proc/compositor"));
    assert(closeCompositor.captureOwner === "", "/proc/compositor kept stale capture owner after close");
    assert(closeCompositor.pointerLock.activeWindowId === "" && closeCompositor.pointerLock.releaseReason === "window-close", "/proc/compositor kept stale pointer lock owner after close");
    assert(!closeCompositor.surfaces.some((surface) => surface.windowId === "browser"), "/proc/compositor kept a closed browser surface");
    assert(closeCompositor.surfaceCleanup.lastCleanup.windowId === "browser" && closeCompositor.surfaceCleanup.lastCleanup.staleCapture === false, "/proc/compositor did not record clean surface cleanup");
    liveManager.open({
      id: "browser",
      appId: "browser",
      pid: 42,
      title: "Browser.app",
      width: 640,
      height: 420,
      manifest: { capabilities: [] },
      render: () => {},
    });
    liveManager.activate("browser");
    assert(api.getState("browser").title === "Example Domain", "window API state was not preserved after activate");
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
