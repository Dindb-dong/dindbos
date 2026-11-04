# Liquid Glass

dindbOS uses a rounded glass lens to refract the **live DOM behind each surface** in desktop Chromium. A generated RG displacement map feeds an SVG `feImage` → `feDisplacementMap` filter, applied through `backdrop-filter`. The browser composites the changing backdrop; the adapter never takes screenshots, clones the desktop, or distorts foreground text and controls.

The signed-distance/map/filter pipeline is adapted from [Shu Ding's MIT implementation](https://github.com/shuding/liquid-glass/blob/a2d2e847f793430e3409a52927af815a23f4d372/liquid-glass.js). dindbOS adds a curved refractive rim, scoped ownership, bounded maps, resize scheduling, accessibility fallbacks and complete cleanup. Keep [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) in redistributions.

## Integration

The shell installs and destroys the adapter with its own lifecycle. Configure the public SDK through `ui`:

```js
createAndBootDindbOS({
  root,
  ui: { liquidGlass: { strength: 1, blur: 0.6, maxSurfaces: 18 } },
});
// ui: { liquidGlass: false } keeps the ordinary theme material.
```

Internal consumers can use the adapter directly:

```js
import { attachLiquidGlass } from './ui/liquid-glass.js';
import './styles/liquid-glass.css'; // after existing surface styles

const cleanup = attachLiquidGlass(desktopRoot, {
  selector: '[data-glass-surface]',
  strength: 1,
  blur: 0.6,
  maxSurfaces: 18,
});

// On unmount; calling this again is safe.
cleanup();
```

Add `data-glass-surface` to a rounded surface to opt in. The default selector also includes `.dos-dock`, `.dos-menubar`, `.dos-shell-menu` and `.dos-shell-panel`. Nested `.dindbos-host` instances are excluded from their parent's adapter. Each root owns unique SVG filters; cleanup restores prior inline filters and mode attributes without affecting other roots.

Use pixel border radii for predictable rounded lens geometry. Apply the lens to chrome and floating controls, rather than an entire opaque app body. A surface may set the unitless `--liquid-glass-blur` custom property to override the adapter blur; ordinary built-in panels use `5` and menus use `4` to keep background text from competing with controls. Control Center adds rounded module lenses with a softer outer backdrop; its own stylesheet follows the general glass rules. An opaque background or an ancestor backdrop boundary can hide or limit the available scene behind it. The adapter adds no z-index, fixed positioning, pointer handlers or stacking isolation to the decorated surface.

| Option | Default | Meaning |
| --- | --- | --- |
| `selector` | opt-in plus shell selectors | Surfaces owned by this root |
| `strength` | `1` | Rim displacement, clamped to `0`–`3` |
| `blur` | `0.6` | Additional backdrop softness in CSS pixels |
| `maxSurfaces` | `18` | Maximum active surfaces, capped at `48` |
| `maxPixels` | `150000` | Raster budget per map, capped at `262144` |
| `maxDimension` | `768` | Longest map side, capped at `1024` |
| `enabled` | `true` | `false` selects opaque reduced-transparency mode |

Newly inserted chrome receives a map immediately. Resize changes reuse the previous map until an 80 ms quiet period, with a 240 ms maximum wait during continuous animation; the latest dimensions then regenerate in one animation frame. Hidden surfaces do not consume the active-surface budget. Unchanged dimensions reuse their map. Dock pointer handling reads all icon bounds before writing changed proximity values. No idle animation loop or backdrop capture runs.

Each desktop adapts independently. Clients reporting four or fewer CPU threads or 4 GB of device memory start with a 40,000-pixel / 384-pixel-side map budget. Repeated map work above 12 ms or active scheduled frames delayed more than 50 ms lower the budget, then use the existing frosted fallback if pressure persists. Three repeated over-budget samples are needed per step; hidden tabs do not count. Quality only decreases during that mount to avoid oscillation, and a remount starts a fresh assessment. `data-glass-quality` reports `full`, `economy`, or `frosted`; accessibility modes still take precedence. These thresholds bound adaptation, not a guarantee of frame rate on every GPU. Maps use PNG data URLs, requiring `img-src data:` in restrictive CSP configurations. There are no external asset requests or Blob URLs.

`--liquid-glass-blur` overrides softness per surface (a number in CSS pixels, limited to `0`–`24`). Shell panels and menus use a stronger tint and modest softness so background labels cannot compete with controls; the Dock retains a clearer lens. PNG displacement maps decode asynchronously, so pixel comparisons must allow the initial map to settle before capturing the baseline.

## Browser and accessibility behavior

Desktop Chromium supports the refractive SVG backdrop pipeline. Safari and Firefox currently receive a frosted tint/blur fallback; their rendering must not be described as equivalent refraction. The root's `data-glass-engine` and each surface's `data-liquid-glass-mode` report `refraction`, `frosted` or `reduced`. Syntax support alone does not prove optical rendering, so the adapter conservatively enables the pipeline only on recognized desktop Chromium.

`prefers-reduced-transparency: reduce`, forced colors, or `enabled: false` select an opaque surface and remove backdrop filtering. The adapter does not animate; reduced-motion rules for shell transitions remain the shell's responsibility. Foreground text and buttons are outside the filter input and remain crisp and interactive.

## Verification

Run `node scripts/smoke-liquid-glass.js` for map bounds and lens geometry, and `node scripts/smoke-liquid-glass-scheduling.js` for deterministic resize coalescing, adaptation, hidden-tab behavior, isolation and cleanup. Run `node scripts/smoke-liquid-glass-browser.js` with an available Playwright Chromium, or set `CHROME_PATH` to an existing Chrome binary. This test opens **only headless Chromium**, starts a temporary isolated Vite fixture, and closes both afterward.

The browser check also counts map rebuilds over 24 animated resize frames and exercises isolated fallback with CPU throttling and a deliberately slow image encoder. It compares actual rendered pixels with the same tint and blur but no SVG displacement. It also moves real background DOM, records the live refraction, clicks foreground controls, resizes a surface, exercises accessibility mode, and checks two-root isolation and idempotent cleanup. Evidence is written under ignored `internal/docs/qa/liquid-glass/`; `DINDBOS_QA_OUTPUT` can choose another directory. These checks establish the optical mechanism, while integrated desktop screenshots and interaction review remain necessary for visual polish.

With the showcase already running, `node scripts/smoke-liquid-glass-integrated-browser.js` checks the actual desktop at `http://127.0.0.1:5174` (`DINDBOS_BASE_URL` overrides this). It preserves that server. The check settles image decoding, compares Control Center and Dock in optical/baseline/baseline/optical order, asserts stable repeated frames, and tests foreground input, light/dark appearance and forced-color Dock opacity. Its temporary stylesheet baseline survives shell clock mutations that legitimately reapply the adapter's inline filter. Evidence goes to `internal/docs/qa/liquid-glass-integrated/`.

Run `node scripts/smoke-liquid-glass-integrated-browser.js` against the running showcase (default `http://127.0.0.1:5174`, override with `DINDBOS_QA_URL`) for real Control Center and Dock comparisons, including stable optical/baseline/baseline/optical captures and dark forced-colors behavior. `npm run verify:ui` includes both isolated and integrated optical checks.
