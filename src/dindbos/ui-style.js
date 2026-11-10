export const UI_STYLES = Object.freeze(["macos", "windows", "ios", "android"]);
export const MOBILE_UI_WIDTH = 760;

export function normalizeUIStyleOptions(value = {}) {
  const style = value.style ?? "macos";
  if (!UI_STYLES.includes(style)) throw new TypeError("DindbOS ui.style must be macos, windows, ios, or android");
  if (value.mobileStyle !== undefined && !["ios", "android"].includes(value.mobileStyle)) {
    throw new TypeError("DindbOS ui.mobileStyle must be ios or android");
  }
  return { ...value, style };
}

export function resolveUIStyle(options = {}, width = 1024) {
  const style = options.style || "macos";
  if (width > 0 && width <= MOBILE_UI_WIDTH) return options.mobileStyle || style;
  return style === "ios" || style === "android" ? "macos" : style;
}
