#!/usr/bin/env node
import {
  WindowManager,
  constrainWindowRect,
  isMobileWindowViewport,
  mobileWindowPlacement,
  nextFocusWindowId,
  preferredWindowSize,
  readWindowPlacements,
  restoreWindowPlacement,
  snapWindowRect,
  snapZoneForPoint,
  windowPlacementsPath,
  writeWindowPlacements,
} from "../src/dindbos/window-manager.js";
import { KernelObjectRegistry } from "../src/dindbos/kernel-objects.js";
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

const declaredMinimum = constrainWindowRect({ left: 1100, top: 500, width: 200, height: 200 }, { width: 1200, height: 900 }, { minWidth: 700, minHeight: 500 });
assert(declaredMinimum.width === 700 && declaredMinimum.height === 500 && declaredMinimum.left === 492, "declared minima must be included before origin clamping");
const restoredMinimum = restoreWindowPlacement({ left: 900, top: 700, width: 200, height: 200 }, { left: 8, top: 58, width: 200, height: 200 }, { width: 800, height: 700 }, { minWidth: 700, minHeight: 500 });
assert(restoredMinimum.width === 700 && restoredMinimum.height === 500 && restoredMinimum.left === 92, "saved placements must honor app minima");

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
const fillPlacement = preferredWindowSize({}, { width: 1200, height: 800 });
assert(fillPlacement.width === 1144, `default app width did not fill viewport: ${fillPlacement.width}`);
assert(fillPlacement.height === 688, `default app height did not fill viewport: ${fillPlacement.height}`);
const explicitPlacement = preferredWindowSize({ width: 420 }, { width: 1200, height: 800 });
assert(explicitPlacement.width === 420 && explicitPlacement.height === 520, "explicit app size fallback mismatch");

assert(snapZoneForPoint({ x: 2, y: 300 }, { width: 900, height: 700 }) === "left", "left snap zone mismatch");
assert(snapZoneForPoint({ x: 890, y: 300 }, { width: 900, height: 700 }) === "right", "right snap zone mismatch");
assert(snapZoneForPoint({ x: 400, y: 3 }, { width: 900, height: 700 }) === "top", "top snap zone mismatch");
const leftSnap = snapWindowRect("left", { width: 900, height: 700 });
assert(leftSnap.left === 8 && leftSnap.top === 58, "left snap origin mismatch");
assert(leftSnap.width === 442 && leftSnap.height === 626, `left snap size mismatch: ${JSON.stringify(leftSnap)}`);
const rightSnap = snapWindowRect("right", { width: 900, height: 700 });
assert(rightSnap.left === 450 && rightSnap.width === 442, `right snap mismatch: ${JSON.stringify(rightSnap)}`);

const workspaceViewport = new WindowManager({
  root: { clientWidth: 1440, clientHeight: 900, getBoundingClientRect: () => ({ left: 70, top: 120, width: 1440, height: 900 }) },
  shell: { refs: { dock: { getBoundingClientRect: () => ({ left: 600, top: 943, width: 400, height: 69 }) } } },
}).viewport();
assert(workspaceViewport.bottomInset === 85, "Dock reservation must be measured relative to its own host, including the gap");
const calendarBounds = constrainWindowRect({ left: 320, top: 235, width: 880, height: 630 }, workspaceViewport);
assert(calendarBounds.top + calendarBounds.height === 815, "a cascaded Calendar must stop above the visible Dock");
const dockSnap = snapWindowRect("right", workspaceViewport);
assert(dockSnap.top + dockSnap.height === 815, "snapped windows must use the same Dock boundary");
const oversizedWorkspace = constrainWindowRect({ left: 0, top: 0, width: 1440, height: 900 }, workspaceViewport);
assert(oversizedWorkspace.height === 757, "large windows must fit the remaining menu/Dock workspace");
const hiddenDockViewport = new WindowManager({
  root: { clientWidth: 900, clientHeight: 700, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
  shell: { refs: { dock: { getBoundingClientRect: () => ({ top: 0, width: 0, height: 0 }) } } },
}).viewport();
assert(hiddenDockViewport.bottomInset === 8, "an absent or hidden Dock must not reserve a phantom fixed height");

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
assert(manager.activeWindowId === "one", "minimizing active window did not focus the next visible window");
assert(manager.appDockStates().one.active === true, "Dock must identify the focused app");
assert(manager.appDockStates().two.active === false, "minimized apps cannot be active in the Dock");
assert(manager.dockApps().find((entry) => entry.appId === "one").active === true, "transient Dock apps retain focused state");
assert(manager.minimizedWindows().some((entry) => entry.id === "two"), "minimized windows did not expose dock entries");
assert(manager.appDockStates().two.minimized === true, "minimized app did not expose yellow dock state");
assert(manager.dockApps(new Set(["one"])).some((entry) => entry.id === "two" && entry.minimized), "unpinned minimized app did not expose a dock thumbnail");
assert(manager.restoreLatestMinimizedApp("two") === true, "restoreLatestMinimizedApp did not restore the app window");
assert(manager.windows.get("two").minimized === false, "restoreLatestMinimizedApp left the window minimized");
assert(manager.focusLatestAppWindow("two") === true, "focusLatestAppWindow did not focus the running app window");
manager.focus("one");
manager.handleGlobalKeyDown({ ctrlKey: true, key: "w", preventDefault: () => {} });
assert(!manager.windows.has("one"), "ctrl-w did not close active visible window");

function bootOs() {
  const permissions = new PermissionPolicy();
  const os = {
    permissions,
    session: { user: "guest", groups: ["users"], home: "/home/guest" },
    fs: new VirtualFileSystem(null, { home: "/home/guest", policy: permissions }),
    clipboard: createTestClipboard(),
  };
  os.objects = new KernelObjectRegistry(os);
  return os;
}

function ensureProcPid(os, pid) {
  const system = os.permissions.systemPrincipal();
  if (!os.fs.exists("/proc")) os.fs.createDirectory("/proc", "/", { owner: "root", group: "root" }, system);
  const path = `/proc/${pid}`;
  if (!os.fs.exists(path)) os.fs.createDirectory(path, "/", { owner: "root", group: "root" }, system);
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

function inputPriorityTarget(windowId, options = {}) {
  return {
    tagName: options.tagName || "DIV",
    dataset: {},
    closest: (selector) => {
      if (selector === "[data-window-id]") return { dataset: { windowId } };
      if (options.osManagedDrag && selector.includes("[draggable='true']")) return {};
      if (options.titlebar && selector.includes(".dos-window-titlebar")) return {};
      if (
        selector.includes(".dos-shell")
        || selector.includes(".dos-desktop")
        || selector.includes(".dos-dock")
        || selector.includes(".dos-menubar")
        || selector.includes(".dos-window,")
        || selector === ".dos-window"
      ) return {};
      return null;
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
    id,
    appId: id,
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
  const windowListeners = new Map();
  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: (type, handler) => {
      windowListeners.set(type, handler);
    },
    removeEventListener: (type, handler) => {
      if (windowListeners.get(type) === handler) windowListeners.delete(type);
    },
    dispatchTestEvent: (type, event = {}) => {
      windowListeners.get(type)?.({ type, ...event });
    },
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
    [42, 43, 44].forEach((pid) => ensureProcPid(liveOs, pid));
    liveOs.processes = {
      markReady: () => {},
      updateWindowState: () => {},
      get: (pid) => ({
        pid: Number(pid),
        credentials: { user: "guest", uid: 1000, gid: 100, groups: ["users"] },
      }),
    };
    const liveManager = new WindowManager(liveOs);
    liveOs.windows = liveManager;
    let dockRenderCount = 0;
    liveOs.shell = {
      refs: { dock: new FakeElement("dock") },
      renderDock: () => { dockRenderCount += 1; },
    };
    const layer = new FakeElement("div");
    const taskStrip = new FakeElement("nav");
    liveManager.mount(layer, taskStrip);
    let disposedApps = 0;
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
        return () => { disposedApps += 1; };
      },
    });
    liveManager.minimize("browser");
    const task = liveManager.windows.get("browser");
    assert(task.frame.hidden === false, "window was hidden before minimize animation could run");
    assert(task.frame.classList.contains("is-minimizing"), "window did not enter minimizing animation state");
    assert(liveManager.minimizedWindows().some((entry) => entry.id === "browser" && entry.appId === "browser"), "minimized browser was not exposed to dock");
    assert(liveManager.appDockStates().browser.minimized === true, "minimized browser did not expose minimized dock state");
    assert(liveManager.dockApps(new Set()).some((entry) => entry.id === "browser" && entry.minimized), "running unpinned browser did not expose dock app item");
    assert(dockRenderCount >= 2, "minimize did not request dock rerender");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert(task.frame.hidden === true, "window was not hidden after minimize animation");
    assert(!task.frame.classList.contains("is-minimizing"), "window kept minimizing class after animation");
    assert(liveManager.restoreLatestMinimizedApp("browser") === true, "dock app restore did not reopen minimized browser");
    assert(api.getState("browser").address === "https://example.com", "window API state was not preserved after minimize/focus");
    assert(task.frame.hidden === false, "focus did not reveal minimized window");
    assert(!task.frame.classList.contains("is-minimizing"), "focus did not cancel minimizing animation state");
    const input = liveManager.recordInputEvent("pointerdown", { clientX: 22, clientY: 44, pointerType: "mouse", button: 0 });
    assert(input.windowId === "browser", "compositor input did not bind to focused window");
    const compositor = liveManager.compositorStatus();
    assert(compositor.activeWindowId === "browser" && compositor.focusedPid === 42, "compositor status did not expose focused surface");
    assert(compositor.surfaceCount === 1 && compositor.surfaces[0].rect.width === 640, "compositor status did not expose surface geometry");
    assert(compositor.surfaces[0].objectId && compositor.surfaces[0].handleId, "compositor status did not expose window object and handle ids");
    assert(task.objectId && task.handleId, "window task did not receive kernel object and handle ids");
    assert(liveOs.objects.get(task.objectId)?.type === "window", "window kernel object was not registered");
    assert(liveOs.objects.getHandle(task.handleId)?.rights.includes("capture-self"), "window handle missing capture-self right");
    const windowProcfs = JSON.parse(liveOs.fs.readFile("/proc/42/window.json"));
    assert(windowProcfs.objectId === task.objectId && windowProcfs.handleId === task.handleId, "/proc pid window record missing object or handle id");
    assert(JSON.parse(liveOs.fs.readFile("/proc/42/handles.json")).some((entry) => entry.id === task.handleId && entry.objectType === "window"), "/proc pid handles missing window handle");
    const procCompositor = JSON.parse(liveOs.fs.readFile("/proc/compositor"));
    assert(procCompositor.lastInputEvent.type === "pointerdown", "/proc/compositor did not expose last input event");
    task.titlebar.listeners.pointerdown({
      pointerId: 6,
      button: 0,
      clientX: 80,
      clientY: 90,
      target: { closest: () => null },
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    assert(task.frame.classList.contains("is-dragging"), "window drag did not mark the frame as dragging");
    assert(task.titlebar.capturedPointerIds.has(6), "window drag did not capture the pointer");
    globalThis.window.dispatchTestEvent("pointermove", {
      pointerId: 6,
      clientX: -800,
      clientY: -800,
      preventDefault: () => {},
    });
    assert(Number.parseFloat(task.frame.style.left) === 8, "window drag did not clamp left edge into viewport");
    assert(Number.parseFloat(task.frame.style.top) === 58, "window drag did not clamp top edge below menu bar");
    globalThis.window.dispatchTestEvent("pointerup", {
      pointerId: 6,
      clientX: 2,
      clientY: 240,
      preventDefault: () => {},
    });
    assert(!task.frame.classList.contains("is-dragging"), "window drag did not clear dragging state");
    assert(task.titlebar.releasedPointerIds.includes(6), "window drag did not release pointer capture");
    assert(Number.parseFloat(task.frame.style.left) === 8, "window drag did not snap to the left edge");
    assert(Number.parseFloat(task.frame.style.width) === 504, "window drag did not apply left snap width");
    task.titlebar.listeners.dblclick({
      target: { closest: () => null },
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    assert(task.maximized === true, "window titlebar double click did not maximize");
    assert(task.frame.classList.contains("is-maximized"), "window titlebar double click did not mark frame maximized");
    task.titlebar.listeners.dblclick({
      target: { closest: () => null },
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    assert(task.maximized === false, "window titlebar double click did not restore");
    assert(!task.frame.classList.contains("is-maximized"), "window titlebar double click did not clear maximized state");
    task.titlebar.listeners.pointerdown({
      pointerId: 66,
      button: 2,
      clientX: 80,
      clientY: 90,
      target: { closest: () => null },
    });
    assert(!task.titlebar.capturedPointerIds.has(66), "secondary pointer button started a window drag");
    const imeRoute = liveManager.routeInputEvent("compositionupdate", { data: "한" });
    assert(imeRoute.handled && imeRoute.targetPid === 42, "compositor input router did not route IME event to focused window");
    const dropRoute = liveManager.routeInputEvent("drop", { clientX: 80, clientY: 90 });
    assert(dropRoute.handled && dropRoute.targetWindowId === "browser", "compositor input router did not route drop event");
    const osTarget = inputPriorityTarget("browser");
    let contextPrevented = false;
    const contextRoute = liveManager.handleBrowserDefaultEvent("contextmenu", {
      target: osTarget,
      preventDefault: () => { contextPrevented = true; },
    });
    assert(contextRoute.handled && contextRoute.browserDefaultPrevented && contextPrevented, "OS context menu did not claim browser context menu");
    let selectPrevented = false;
    const selectRoute = liveManager.handleBrowserDefaultEvent("selectstart", {
      target: osTarget,
      preventDefault: () => { selectPrevented = true; },
    });
    assert(selectRoute.browserDefaultPrevented && selectPrevented, "OS selectstart did not suppress browser selection on chrome");
    let textSelectPrevented = false;
    const textSelectRoute = liveManager.handleBrowserDefaultEvent("selectstart", {
      target: inputPriorityTarget("browser", { tagName: "INPUT" }),
      preventDefault: () => { textSelectPrevented = true; },
    });
    assert(!textSelectRoute.browserDefaultPrevented && !textSelectPrevented, "text input selection was incorrectly suppressed");
    let nativeDragPrevented = false;
    const nativeDragRoute = liveManager.handleBrowserDefaultEvent("dragstart", {
      target: osTarget,
      preventDefault: () => { nativeDragPrevented = true; },
    });
    assert(nativeDragRoute.browserDefaultPrevented && nativeDragPrevented, "native browser drag was not suppressed on OS surface");
    let managedDragPrevented = false;
    const managedDragRoute = liveManager.handleBrowserDefaultEvent("dragstart", {
      target: inputPriorityTarget("browser", { osManagedDrag: true }),
      preventDefault: () => { managedDragPrevented = true; },
    });
    assert(!managedDragRoute.browserDefaultPrevented && !managedDragPrevented, "DindbOS managed drag was incorrectly suppressed");
    let dropPrevented = false;
    const claimedDropRoute = liveManager.handleBrowserDefaultEvent("drop", {
      target: osTarget,
      preventDefault: () => { dropPrevented = true; },
    });
    assert(claimedDropRoute.browserDefaultPrevented && dropPrevented, "OS drop did not suppress browser file-open defaults");
    const routedCompositor = JSON.parse(liveOs.fs.readFile("/proc/compositor"));
    assert(routedCompositor.inputRouter.routed >= 8 && routedCompositor.inputRouter.lastRoute.browserDefaultPrevented === true, "/proc/compositor did not expose input priority state");
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
    const trustedSurface = liveManager.openTrustedPrompt({
      id: "trusted-prompt-smoke",
      ownerPid: 42,
      appId: "browser",
      packageId: "system.browser",
      capability: "screen.capture",
      target: "desktop",
      message: "Capture the desktop",
      status: "pending",
    });
    assert(trustedSurface.compositorOwned && trustedSurface.captureProtected, "trusted prompt surface was not compositor-owned and capture-protected");
    const trustedStatus = JSON.parse(liveOs.fs.readFile("/proc/compositor")).trustedSurfaces.find((surface) => surface.id === trustedSurface.id);
    assert(trustedStatus?.promptId === "trusted-prompt-smoke" && trustedStatus.zIndex >= 100000, "/proc/compositor did not expose protected trusted UI surface");
    const protectedDesktopCapture = recorderApi.captureDesktop({ userApproved: true });
    assert(!protectedDesktopCapture.handled && protectedDesktopCapture.deniedReason === "trusted-ui-protected", "desktop capture was not denied while trusted UI was visible");
    const protectedWindowCapture = recorderApi.captureSurface({ targetWindowId: "settings", userApproved: true });
    assert(!protectedWindowCapture.handled && protectedWindowCapture.deniedReason === "trusted-ui-protected", "cross-window capture was not denied while trusted UI was visible");
    liveManager.closeTrustedPrompt(trustedSurface.id, "smoke-cleanup");
    const resumedDesktopCapture = recorderApi.captureDesktop({ userApproved: true });
    assert(resumedDesktopCapture.handled && resumedDesktopCapture.surfaces.length >= 3, "desktop capture did not resume after trusted UI closed");
    const captureStatus = JSON.parse(liveOs.fs.readFile("/proc/compositor")).surfaceCapture;
    assert(captureStatus.captured === 3 && captureStatus.denied >= 4, "/proc/compositor did not expose surface capture policy state");
    const recorderTask = liveManager.windows.get("recorder");
    liveOs.objects.revokeHandle(recorderTask.handleId, "window-handle-smoke");
    const staleDesktopCapture = recorderApi.captureDesktop({ userApproved: true });
    assert(!staleDesktopCapture.handled && staleDesktopCapture.deniedReason === "handle-ESTALE", "stale window handle did not deny desktop capture");
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
    liveManager.close("browser");
    assert(disposedApps === 1, "closing a window did not dispose its mounted app exactly once");
    assert(liveOs.objects.get(task.objectId).status === "revoked", "window close did not revoke window object");
    assert(liveOs.objects.getHandle(task.handleId).status === "revoked", "window close did not revoke window handle");
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
    liveManager.close("browser");
    await runCloseGuardSmoke(liveManager, liveOs);
    liveOs.root = {
      clientWidth: 580, clientHeight: 460,
      contains: (element) => element?.inside === true,
      getBoundingClientRect: () => ({ left: 300, top: 200, width: 580, height: 460 }),
    };
    let chromeDisposed = 0;
    liveOs.uiOptions = { slots: { windowChrome: ({ element, defaultRender }) => {
      assert(element, "windowChrome was not passed its host element");
      defaultRender();
      return () => { chromeDisposed += 1; };
    } } };
    liveManager.open({ id: "embedded", appId: "embedded", pid: 44, title: "Embedded", width: 900, height: 700, manifest: { capabilities: [] }, render: () => () => { disposedApps += 1; } });
    const embedded = liveManager.windows.get("embedded");
    assert(Number.parseFloat(embedded.frame.style.width) <= 564, "embedded window width used browser viewport instead of host");
    assert(Number.parseFloat(embedded.frame.style.height) <= 394, "embedded window height used browser viewport instead of host");
    let hostKeyPrevented = false;
    globalThis.window.dispatchTestEvent("keydown", { key: "w", ctrlKey: true, target: { inside: false }, preventDefault: () => { hostKeyPrevented = true; } });
    assert(!hostKeyPrevented && liveManager.has("embedded"), "desktop consumed a host-page shortcut");
    if (embedded.maximized) liveManager.maximize("embedded");
    embedded.titlebar.listeners.pointerdown({ pointerId: 91, button: 0, clientX: 340, clientY: 280, target: { closest: () => null }, preventDefault() {}, stopPropagation() {} });
    assert(embedded.titlebar.capturedPointerIds.has(91), "embedded drag did not begin");
    embedded.api.setBeforeClose(() => false);
    liveManager.destroy();
    liveManager.destroy();
    assert(disposedApps === 2 && chromeDisposed === 1, "destroy did not dispose app and custom chrome exactly once");
    assert(embedded.titlebar.releasedPointerIds.includes(91), "destroy left a live pointer gesture");
    assert(liveManager.windows.size === 0 && liveManager.layer === null, "destroy retained compositor surfaces");
    globalThis.window.dispatchTestEvent("keydown", { key: "w", ctrlKey: true, target: { inside: true }, preventDefault: () => { hostKeyPrevented = true; } });
    assert(!hostKeyPrevented, "destroy left global shortcut listeners attached");

  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}

async function runCloseGuardSmoke(manager, os) {
  const errors = [];
  os.bus = { emit: (name, value) => { if (name === "window:close-error") errors.push(value); } };
  const open = (id, render = () => {}) => manager.open({ id, appId: id, pid: 44, title: id, width: 400, height: 300, manifest: { capabilities: [] }, render });
  let failedRenderTask;
  let renderFailure;
  try {
    open("guard-render-failure", (_element, api) => {
      api.setBeforeClose(() => false);
      failedRenderTask = manager.windows.get("guard-render-failure");
      throw new Error("render failed after guard registration");
    });
  } catch (error) { renderFailure = error; }
  assert(renderFailure?.message === "render failed after guard registration", "render failure did not reach its caller");
  assert(!manager.has("guard-render-failure") && failedRenderTask.frame.removed, "render failure left a guarded orphan window");
  assert(os.objects.get(failedRenderTask.objectId).status === "revoked", "render failure retained a live window kernel object");

  const previousUiOptions = os.uiOptions;
  let failedChromeTask;
  let chromeFailure;
  let appRendered = false;
  try {
    os.uiOptions = { slots: { windowChrome: ({ state, actions }) => {
      actions.setBeforeClose(() => false);
      failedChromeTask = state;
      throw new Error("chrome failed after guard registration");
    } } };
    open("guard-chrome-failure", () => { appRendered = true; });
  } catch (error) { chromeFailure = error; }
  finally { os.uiOptions = previousUiOptions; }
  assert(chromeFailure?.message === "chrome failed after guard registration", "custom chrome failure did not reach its caller");
  assert(!appRendered && !manager.has("guard-chrome-failure") && failedChromeTask.frame.removed, "custom chrome failure left a guarded orphan window");
  assert(os.objects.get(failedChromeTask.objectId).status === "revoked", "custom chrome failure retained a live window kernel object");
  let calls = 0;
  const sync = open("guard-sync");
  const unregisterOld = sync.setBeforeClose(() => { calls += 1; return false; });
  assert(sync.close() === false && manager.has("guard-sync") && calls === 1, "a declined sync guard closed the draft");
  const unregisterCurrent = sync.setBeforeClose(() => false);
  unregisterOld();
  assert(sync.close() === false && manager.has("guard-sync"), "stale guard unregister removed a newer guard");
  unregisterCurrent();
  sync.setBeforeClose(() => true);
  sync.close();
  assert(!manager.has("guard-sync"), "an approved sync guard did not close");

  let resolveDecision;
  let pendingCalls = 0;
  const pending = open("guard-pending");
  pending.setBeforeClose(() => { pendingCalls += 1; return new Promise((resolve) => { resolveDecision = resolve; }); });
  const first = pending.close();
  const repeated = pending.close();
  assert(first === repeated && pendingCalls === 1 && manager.has("guard-pending"), "repeated closes did not share one pending guard");
  resolveDecision(false);
  assert(await first === false && manager.has("guard-pending"), "async cancellation closed the draft");
  const approved = pending.close();
  resolveDecision(true);
  assert(await approved === true && !manager.has("guard-pending") && pendingCalls === 2, "async approval repeated the guard or failed to close");

  const rejection = open("guard-error");
  rejection.setBeforeClose(() => Promise.reject(new Error("save unavailable")));
  assert(await rejection.close() === false && manager.has("guard-error") && errors.length === 1, "a rejected close guard did not retain draft/report its error");
  rejection.setBeforeClose(() => { throw new Error("sync save unavailable"); });
  assert(rejection.close() === false && manager.has("guard-error") && errors.length === 2, "a throwing close guard did not retain draft/report its error");
  manager.close("guard-error", { force: true });
  assert(!manager.has("guard-error"), "forced close did not bypass guard");

  const killed = open("guard-killed");
  killed.setBeforeClose(() => false);
  manager.close("guard-killed", { skipOnClose: true });
  assert(!manager.has("guard-killed"), "process termination did not bypass guard");

  const stale = open("guard-stale");
  stale.setBeforeClose(() => new Promise((resolve) => { resolveDecision = resolve; }));
  const staleRequest = stale.close();
  manager.close("guard-stale", { force: true });
  const replacement = open("guard-stale");
  resolveDecision(true);
  await staleRequest;
  assert(manager.has("guard-stale"), "late async approval closed a replacement window with the same id");
  replacement.close();

  const destroyed = open("guard-destroyed");
  destroyed.setBeforeClose(() => false);
  os.destroyed = true;
  destroyed.close();
  os.destroyed = false;
  assert(!manager.has("guard-destroyed"), "runtime destruction did not bypass guard");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
