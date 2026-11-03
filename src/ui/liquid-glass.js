/* Optical-map/SVG pipeline adapted from shuding/liquid-glass (MIT).
 * Copyright (c) 2025 Shu Ding. See THIRD_PARTY_NOTICES.md.
 * The scoped adapter, bounded scheduling and lens profile are dindbOS additions.
 */
const SVG = "http://www.w3.org/2000/svg";
const DEFAULT_SELECTOR = "[data-glass-surface], .dos-dock, .dos-menubar, .dos-shell-menu, .dos-shell-panel";
let instanceId = 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function roundedRectDistance(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x) - halfWidth + radius;
  const qy = Math.abs(y) - halfHeight + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

/** RG encodes displacement; neutral pixels do not bend the backdrop. */
export function createGlassMap(width, height, radius, { strength = 1, maxPixels = 150000, maxDimension = 768 } = {}) {
  maxPixels = clamp(Number(maxPixels) || 150000, 4096, 262144);
  maxDimension = clamp(Number(maxDimension) || 768, 64, 1024);
  strength = clamp(Number(strength) || 0, 0, 3);
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)), maxDimension / Math.max(width, height));
  const mapWidth = Math.max(2, Math.round(width * scale));
  const mapHeight = Math.max(2, Math.round(height * scale));
  const data = new Uint8ClampedArray(mapWidth * mapHeight * 4);
  const shifts = new Float32Array(mapWidth * mapHeight * 2);
  const r = clamp(radius, 1, Math.min(width, height) / 2);
  const bevel = Math.min(30, Math.min(width, height) * .32, Math.max(8, r));
  let maximum = 1;
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const px = (x + .5) * width / mapWidth - width / 2;
      const py = (y + .5) * height / mapHeight - height / 2;
      const distance = roundedRectDistance(px, py, width / 2, height / 2, r);
      const at = (y * mapWidth + x) * 2;
      if (distance > 0 || -distance > bevel) continue;
      const nx = roundedRectDistance(px + .5, py, width / 2, height / 2, r) - roundedRectDistance(px - .5, py, width / 2, height / 2, r);
      const ny = roundedRectDistance(px, py + .5, width / 2, height / 2, r) - roundedRectDistance(px, py - .5, width / 2, height / 2, r);
      const length = Math.hypot(nx, ny) || 1;
      const position = clamp(-distance / bevel, 0, 1);
      // A curved rim has a steep surface normal near its edge. Snell's law
      // reduces the angle inside glass (IOR 1.48); the slab shifts the ray.
      const incident = Math.atan((1 - position) * 2.4);
      const transmitted = Math.asin(Math.sin(incident) / 1.48);
      const shift = Math.tan(incident - transmitted) * bevel * .85 * strength * Math.sin(Math.PI * Math.sqrt(position));
      shifts[at] = -nx / length * shift;
      shifts[at + 1] = -ny / length * shift;
      maximum = Math.max(maximum, Math.abs(shifts[at]), Math.abs(shifts[at + 1]));
    }
  }
  for (let index = 0; index < mapWidth * mapHeight; index++) {
    data[index * 4] = Math.round(127.5 + shifts[index * 2] / maximum * 127.5);
    data[index * 4 + 1] = Math.round(127.5 + shifts[index * 2 + 1] / maximum * 127.5);
    data[index * 4 + 2] = 128;
    data[index * 4 + 3] = 255;
  }
  return { width: mapWidth, height: mapHeight, data, displacement: maximum * 2 };
}

/** Decorates only surfaces owned by root. No scene cloning or page screenshots. */
export function attachLiquidGlass(root, options = {}) {
  if (!root?.ownerDocument) return () => {};
  const document = root.ownerDocument;
  const view = document.defaultView;
  const selector = options.selector || DEFAULT_SELECTOR;
  const maximumSurfaces = clamp(options.maxSurfaces ?? 18, 1, 48);
  const prefix = `dindbos-glass-${++instanceId}-${Math.random().toString(36).slice(2, 8)}`;
  const surfaces = new Map();
  let destroyed = false;
  let frame = null;
  const reduced = view.matchMedia?.("(prefers-reduced-transparency: reduce)");
  const forced = view.matchMedia?.("(forced-colors: active)");
  const chromium = /(?:Chrome|Chromium|Edg)\//.test(view.navigator.userAgent) && !/EdgiOS|CriOS/.test(view.navigator.userAgent);
  const supported = chromium && Boolean(view.CSS?.supports?.("backdrop-filter", 'url("#glass")'));
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("data-liquid-glass-definitions", prefix);
  svg.style.cssText = "position:absolute;pointer-events:none;overflow:hidden;width:0;height:0";
  const defs = document.createElementNS(SVG, "defs"); svg.append(defs); root.append(svg);
  const originalRootMode = root.getAttribute("data-glass-engine");
  const owned = (element) => !root.matches(".dindbos-host") || element.closest(".dindbos-host") === root;
  const mode = () => options.enabled === false || reduced?.matches || forced?.matches ? "reduced" : supported ? "refraction" : "frosted";
  const schedule = () => { if (!destroyed && frame === null) frame = view.requestAnimationFrame(update); };
  const resize = view.ResizeObserver ? new view.ResizeObserver(schedule) : null;

  function remove(element, record) {
    resize?.unobserve(element);
    record.filter?.remove();
    if (record.previousMode === null) element.removeAttribute("data-liquid-glass-mode"); else element.setAttribute("data-liquid-glass-mode", record.previousMode);
    for (const [name, value, priority] of record.styles) {
      if (value) element.style.setProperty(name, value, priority); else element.style.removeProperty(name);
    }
    surfaces.delete(element);
  }

  function update() {
    frame = null;
    if (destroyed) return;
    const currentMode = mode();
    root.setAttribute("data-glass-engine", currentMode);
    const candidates = [...root.querySelectorAll(selector)].filter(element => owned(element)
      && element.offsetWidth >= 2 && element.offsetHeight >= 2 && !element.hidden
      && (!element.checkVisibility || element.checkVisibility({ visibilityProperty: true }))).slice(0, maximumSurfaces);
    const selected = new Set(candidates);
    for (const [element, record] of surfaces) if (!selected.has(element)) remove(element, record);
    for (const element of candidates) {
      let record = surfaces.get(element);
      if (!record) {
        record = { previousMode: element.getAttribute("data-liquid-glass-mode"), styles: ["backdrop-filter", "-webkit-backdrop-filter"].map((name) => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]), key: "" };
        surfaces.set(element, record); resize?.observe(element);
      }
      element.setAttribute("data-liquid-glass-mode", currentMode);
      if (currentMode !== "refraction") {
        element.style.setProperty("backdrop-filter", currentMode === "reduced" ? "none" : "blur(18px) saturate(1.2)");
        element.style.setProperty("-webkit-backdrop-filter", currentMode === "reduced" ? "none" : "blur(18px) saturate(1.2)");
        continue;
      }
      const width = Math.round(element.offsetWidth);
      const height = Math.round(element.offsetHeight);
      if (width < 2 || height < 2 || element.hidden) continue;
      const computed = view.getComputedStyle(element);
      const radius = parseFloat(computed.borderTopLeftRadius) || 0;
      const key = `${width}:${height}:${radius}:${options.strength ?? 1}`;
      if (record.key !== key || !record.filter) {
        record.key = key;
        const map = createGlassMap(width, height, radius, options);
        const canvas = document.createElement("canvas"); canvas.width = map.width; canvas.height = map.height;
        const context = canvas.getContext("2d");
        if (!context) continue;
        context.putImageData(new view.ImageData(map.data, map.width, map.height), 0, 0);
        if (!record.filter) {
          record.filter = document.createElementNS(SVG, "filter");
          record.filter.id = `${prefix}-${surfaces.size}-${Math.random().toString(36).slice(2, 6)}`;
          record.filter.setAttribute("filterUnits", "userSpaceOnUse");
          record.filter.setAttribute("color-interpolation-filters", "sRGB");
          record.image = document.createElementNS(SVG, "feImage");
          record.image.setAttribute("result", "lens-map");
          record.displace = document.createElementNS(SVG, "feDisplacementMap");
          record.displace.setAttribute("in", "SourceGraphic"); record.displace.setAttribute("in2", "lens-map");
          record.displace.setAttribute("xChannelSelector", "R"); record.displace.setAttribute("yChannelSelector", "G");
          record.filter.append(record.image, record.displace); defs.append(record.filter);
        }
        for (const node of [record.filter, record.image]) {
          node.setAttribute("x", "0"); node.setAttribute("y", "0"); node.setAttribute("width", width); node.setAttribute("height", height);
        }
        record.image.setAttribute("preserveAspectRatio", "none"); record.image.setAttribute("href", canvas.toDataURL());
        record.displace.setAttribute("scale", map.displacement);
      }
      const surfaceBlur = parseFloat(computed.getPropertyValue("--liquid-glass-blur"));
      const blur = Number.isFinite(surfaceBlur) ? clamp(surfaceBlur, 0, 24) : options.blur ?? .6;
      const filter = `url("#${record.filter.id}") blur(${blur}px) saturate(1.18)`;
      element.style.setProperty("backdrop-filter", filter); element.style.setProperty("-webkit-backdrop-filter", filter);
    }
  }

  const mutation = new view.MutationObserver(schedule);
  mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open", "data-glass-surface"] });
  reduced?.addEventListener?.("change", schedule); forced?.addEventListener?.("change", schedule);
  update();
  return () => {
    if (destroyed) return;
    destroyed = true; mutation.disconnect(); resize?.disconnect();
    reduced?.removeEventListener?.("change", schedule); forced?.removeEventListener?.("change", schedule);
    if (frame !== null) view.cancelAnimationFrame(frame);
    for (const [element, record] of surfaces) remove(element, record);
    svg.remove();
    if (originalRootMode === null) root.removeAttribute("data-glass-engine"); else root.setAttribute("data-glass-engine", originalRootMode);
  };
}
