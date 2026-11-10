export const UI_STYLES = Object.freeze(["macos", "windows", "ios", "android"]);
export const MOBILE_UI_WIDTH = 760;
const DEFAULT_AUTO_STYLES = Object.freeze({
  macos: Object.freeze({ desktop: 'windows', mobile: 'android' }),
  windows: Object.freeze({ desktop: 'macos', mobile: 'ios' }),
  android: Object.freeze({ desktop: 'macos', mobile: 'ios' }),
  ios: Object.freeze({ desktop: 'windows', mobile: 'android' }),
  other: Object.freeze({ desktop: 'macos', mobile: 'macos' }),
});

export function normalizeUIStyleOptions(value = {}) {
  const style = value.style ?? "auto";
  if (style !== 'auto' && !UI_STYLES.includes(style)) throw new TypeError("DindbOS ui.style must be auto, macos, windows, ios, or android");
  if (value.mobileStyle !== undefined && !UI_STYLES.includes(value.mobileStyle)) {
    throw new TypeError("DindbOS ui.mobileStyle must be macos, windows, ios, or android");
  }
  const overrides = value.autoStyles === undefined ? {} : value.autoStyles;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new TypeError('DindbOS ui.autoStyles must be a visitor OS map');
  const autoStyles = Object.fromEntries(Object.entries(DEFAULT_AUTO_STYLES).map(([os, pair]) => [os, { ...pair }]));
  for (const [os, pair] of Object.entries(overrides)) {
    if (!Object.hasOwn(autoStyles, os) || !pair || typeof pair !== 'object' || Array.isArray(pair)) throw new TypeError(`DindbOS ui.autoStyles has an invalid visitor OS: ${os}`);
    for (const [mode, preset] of Object.entries(pair)) {
      if (!['desktop', 'mobile'].includes(mode) || !UI_STYLES.includes(preset)) throw new TypeError(`DindbOS ui.autoStyles.${os}.${mode} must name a UI preset`);
      autoStyles[os][mode] = preset;
    }
  }
  return { ...value, style, autoStyles };
}

export function detectVisitorOS(navigator = globalThis.navigator) {
  const agent = navigator?.userAgent || '';
  const platform = navigator?.userAgentData?.platform || navigator?.platform || '';
  if (/Android/i.test(agent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(agent) || (/Mac/i.test(platform) && navigator?.maxTouchPoints > 1)) return 'ios';
  if (/Win/i.test(platform) || /Windows/i.test(agent)) return 'windows';
  if (/Mac/i.test(platform) || /Macintosh/i.test(agent)) return 'macos';
  return 'other';
}

export function resolveUIStyle(options = {}, width = 1024, height = 768, navigator = globalThis.navigator) {
  const style = options.style || 'auto';
  if (style !== 'auto') return width > 0 && width <= MOBILE_UI_WIDTH ? options.mobileStyle || style : style;
  const visitor = detectVisitorOS(navigator);
  const mobile = ['ios', 'android'].includes(visitor) ? width <= height : width > 0 && width <= MOBILE_UI_WIDTH;
  const mode = mobile ? 'mobile' : 'desktop';
  return (mobile && options.mobileStyle) || options.autoStyles?.[visitor]?.[mode] || DEFAULT_AUTO_STYLES[visitor][mode];
}
