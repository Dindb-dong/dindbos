export const DEFAULT_APPEARANCE = Object.freeze({ mode: "system", accent: "#287a58", wallpaper: "meadow", dockSize: 52 });

export const WALLPAPERS = Object.freeze({
  meadow: "var(--wallpaper-meadow)",
  coast: "radial-gradient(ellipse at 16% 14%, #e1e9e9 0%, transparent 46%), radial-gradient(ellipse at 90% 85%, #305a70 0%, transparent 60%), linear-gradient(135deg, #a6c6d1, #6798aa 52%, #244b60)",
  dusk: "radial-gradient(ellipse at 14% 20%, #edcfb8 0%, transparent 52%), radial-gradient(ellipse at 85% 80%, #6d6a83 0%, transparent 58%), linear-gradient(135deg, #c6a693, #98919f 52%, #59596c)",
  graphite: "radial-gradient(ellipse at 20% 15%, #63737a 0%, transparent 55%), linear-gradient(145deg, #39494b, #17292c 70%)",
});

export function normalizeAppearance(value = {}, previous = DEFAULT_APPEARANCE) {
  const result = { ...previous };
  if (value.mode !== undefined) {
    if (!["system", "light", "dark"].includes(value.mode)) throw new TypeError("Appearance mode must be system, light, or dark");
    result.mode = value.mode;
  }
  if (value.accent !== undefined) {
    const accent = String(value.accent).trim();
    if (!accent || (globalThis.CSS?.supports && !CSS.supports("color", accent))) throw new TypeError("Appearance accent must be a CSS color");
    result.accent = accent;
  }
  if (value.wallpaper !== undefined) {
    const wallpaper = String(value.wallpaper).trim();
    if (!wallpaper || (!WALLPAPERS[wallpaper] && globalThis.CSS?.supports && !CSS.supports("background", wallpaper))) throw new TypeError("Wallpaper must be a preset name or CSS background");
    result.wallpaper = wallpaper;
  }
  if (value.dockSize !== undefined) {
    const size = Number(value.dockSize);
    if (!Number.isFinite(size) || size < 36 || size > 72) throw new RangeError("Dock size must be between 36 and 72");
    result.dockSize = size;
  }
  return result;
}

export function applyAppearance(root, value, dark = false) {
  if (!root?.style) return;
  root.setAttribute?.("data-appearance", value.mode === "system" ? (dark ? "dark" : "light") : value.mode);
  root.setAttribute?.("data-wallpaper", value.wallpaper in WALLPAPERS ? value.wallpaper : "custom");
  root.style.setProperty?.("--accent", value.accent);
  root.style.setProperty?.("--accent-strong", value.accent);
  root.style.setProperty?.("--accent-soft", `color-mix(in srgb, ${value.accent} 17%, transparent)`);
  root.style.setProperty?.("--wallpaper", WALLPAPERS[value.wallpaper] || value.wallpaper);
  root.style.setProperty?.("--dock-size", `${value.dockSize}px`);
}
