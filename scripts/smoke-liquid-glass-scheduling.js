import assert from "node:assert/strict";
import { attachLiquidGlass } from "../src/ui/liquid-glass.js";

function fixture({ cores = 8, memory = 8, mapCost = 0 } = {}) {
  let time = 0, nextId = 0, maps = 0, rasterPixels = 0, rasterWidth = 0;
  const timers = new Map(), frames = new Map();
  const media = new Map();
  class Element {
    constructor() {
      this.attributes = new Map(); this.children = []; this.parent = null;
      const styles = new Map();
      this.style = { setProperty: (key, value) => styles.set(key, value), getPropertyValue: key => styles.get(key) || "", getPropertyPriority: () => "", removeProperty: key => styles.delete(key) };
      this.offsetWidth = 100; this.offsetHeight = 60;
    }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    append(child) { this.children.push(child); child.parent = this; }
    remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
    matches() { return false; }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
  }
  let resize, mutation;
  const view = {
    performance: { now: () => time }, navigator: { userAgent: "Chrome/150", hardwareConcurrency: cores, deviceMemory: memory },
    CSS: { supports: () => true },
    matchMedia(query) { if (!media.has(query)) media.set(query, { matches: false, addEventListener(_, fn) { this.listener = fn; }, removeEventListener() { this.listener = null; } }); return media.get(query); },
    requestAnimationFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id),
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: time + delay }); return id; }, clearTimeout: id => timers.delete(id),
    ResizeObserver: class { constructor(fn) { resize = this; this.trigger = fn; } observe() {} unobserve() {} disconnect() { this.disconnected = true; } },
    MutationObserver: class { constructor(fn) { mutation = this; this.trigger = fn; } observe() {} disconnect() { this.disconnected = true; } },
    getComputedStyle: () => ({ borderTopLeftRadius: "20px", getPropertyValue: () => "" }),
    ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
  };
  const document = { defaultView: view, hidden: false, createElementNS: () => new Element(), createElement: () => ({ getContext: () => ({ putImageData(image) { rasterPixels = image.width * image.height; rasterWidth = image.width; } }), toDataURL() { maps++; time += mapCost; return "data:image/png;base64,map"; } }) };
  const root = new Element(), surface = new Element(); root.ownerDocument = document;
  root.querySelectorAll = () => [surface]; root.append(surface);
  const cleanup = attachLiquidGlass(root);
  function advance(ms) {
    const end = time + ms;
    while (true) {
      const due = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      time = due[1].at; timers.delete(due[0]); due[1].fn();
    }
    time = end;
  }
  function frame(delay = 16) { advance(delay); const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)); }
  return { root, surface, media, cleanup, frame, advance, resize: () => resize.trigger(), mutate: () => mutation.trigger([{ target: root }]), get maps() { return maps; }, get rasterPixels() { return rasterPixels; }, get rasterWidth() { return rasterWidth; }, get pending() { return timers.size + frames.size; }, get disconnected() { return resize.disconnected && mutation.disconnected; } };
}

const normal = fixture();
assert.equal(normal.maps, 1, "first visible surface receives its map immediately");
for (let i = 0; i < 12; i++) {
  normal.surface.offsetWidth++;
  normal.resize(); normal.frame();
  normal.mutate(); normal.frame();
}
assert(normal.maps >= 2, "continuous resizing must flush before the quiet period to bound latency");
assert(normal.maps <= 3, `24 animated resize frames must coalesce; maps=${normal.maps}`);
normal.advance(80); normal.frame();
const filter = normal.root.children[1].children[0].children[0];
assert.equal(filter.getAttribute("width"), "112", "latest geometry eventually reaches the filter");
const settled = normal.maps; normal.mutate(); normal.frame();
assert.equal(normal.maps, settled, "unchanged geometry reuses the map");
normal.surface.offsetWidth++; normal.resize();
normal.cleanup(); normal.cleanup(); normal.advance(500); normal.frame();
assert.equal(normal.maps, settled); assert.equal(normal.pending, 0); assert(normal.disconnected);
assert.equal(normal.root.getAttribute("data-glass-quality"), null);

const constrained = fixture({ cores: 2 });
assert.equal(constrained.root.getAttribute("data-glass-quality"), "economy");
constrained.surface.offsetWidth = 800; constrained.surface.offsetHeight = 400;
constrained.resize(); constrained.advance(80); constrained.frame();
assert(constrained.rasterPixels <= 40000 && constrained.rasterWidth <= 384, "constrained clients rasterize within their smaller budget");
const expensive = fixture({ mapCost: 20 });
for (let i = 0; i < 8; i++) {
  expensive.surface.offsetWidth++; expensive.resize(); expensive.advance(80); expensive.frame();
}
assert.equal(expensive.root.getAttribute("data-glass-engine"), "frosted", "repeated costly maps select stable fallback");
assert.equal(normal.root.getAttribute("data-glass-engine"), null, "quality and cleanup remain root-local");
const before = expensive.maps;
expensive.surface.offsetWidth++; expensive.resize(); expensive.advance(80); expensive.frame();
assert.equal(expensive.maps, before, "fallback does not build unused maps");
const forced = expensive.media.get("(forced-colors: active)");
forced.matches = true; forced.listener(); expensive.frame();
assert.equal(expensive.root.getAttribute("data-glass-engine"), "reduced", "accessibility overrides adaptive fallback");
forced.matches = false; forced.listener(); expensive.frame();
assert.equal(expensive.root.getAttribute("data-glass-engine"), "frosted", "no quality oscillation after accessibility reset");
const delayed = fixture();
for (let i = 0; i < 7; i++) { delayed.mutate(); delayed.frame(70); }
assert.equal(delayed.root.getAttribute("data-glass-engine"), "frosted", "repeated active frame stalls reduce compositor work");
const hidden = fixture(); hidden.root.ownerDocument.hidden = true;
for (let i = 0; i < 7; i++) { hidden.mutate(); hidden.frame(100); }
assert.equal(hidden.root.getAttribute("data-glass-quality"), "full", "background-tab scheduling cannot lower quality");
for (const instance of [constrained, expensive, delayed, hidden]) instance.cleanup();
console.log(`liquid glass scheduling smoke ok: 24 animated resize frames -> ${settled - 1} rebuilds, final geometry, independent adaptive budgets/fallback, accessibility, hidden tabs, cleanup`);
