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
assert(os.fs.exists("/var/lib/dindbos/window-placements.json"), "window placement file was not created");

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
    fs: new VirtualFileSystem(null, { home: "/home/guest", policy: permissions }),
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
      render: (_content, windowApi) => {
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
    task.titlebar.listeners.pointerdown({
      pointerId: 7,
      clientX: 10,
      clientY: 10,
      target: { closest: () => null },
    });
    assert(liveManager.compositorStatus().captureOwner === "browser", "compositor did not record pointer capture owner");
    liveManager.close("browser");
    assert(task.titlebar.releasedPointerIds.includes(7), "window close did not release active pointer capture");
    assert(JSON.parse(liveOs.fs.readFile("/proc/compositor")).captureOwner === "", "/proc/compositor kept stale capture owner after close");
    liveManager.open({
      id: "browser",
      appId: "browser",
      pid: 42,
      title: "Browser.app",
      width: 640,
      height: 420,
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
