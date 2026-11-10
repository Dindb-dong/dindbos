# Customize your desktop

The host owns app content and appearance. The runtime owns execution, permissions, virtual files, and window state. Keep that boundary when replacing a view.

## Platform shell

Choose shell layout and navigation through `ui`, independently of the light/dark palette in `theme`. The default `style: "auto"` shows visitors an alternative OS:

| Visitor | Desktop / landscape | Compact / portrait |
| --- | --- | --- |
| macOS | Windows | Samsung-inspired Android |
| Windows | macOS | iOS |
| Android | macOS | iOS |
| iOS / iPadOS | Windows | Samsung-inspired Android |
| Unknown / other | macOS | macOS |

For desktop visitors, compact means a host at most760 CSS pixels wide. For detected phones/tablets, portrait and landscape use the host's width/height, so a740×390 landscape host already selects its desktop UI. This responds to the embedded container, rather than assuming the surrounding page fills the screen. OS detection uses browser-reported platform/UA, including touch-enabled desktop-mode iPads; spoofed or restricted identifiers can be misclassified. No device permission or network request is needed.

These are defaults, not restrictions. Override individual visitor rules; omitted entries retain their defaults:

```js
await mountDindbOSDesktop({
  root,
  ui: {
    style: "auto",
    autoStyles: {
      macos: { desktop: "macos", mobile: "ios" },
      ios: { desktop: "windows", mobile: "ios" },
      other: { desktop: "windows", mobile: "android" },
    },
  },
});
```

Use a named `style` to force a preset for every visitor and host size, or add `mobileStyle` for a fixed desktop/compact pair:

```jsx
<DindbOSDesktop ui={{ style: "windows", mobileStyle: "ios" }} />
```

```js
await mountDindbOSDesktop({ root, ui: { style: "macos", mobileStyle: "android" } });
```

`style` accepts `auto` (default), `macos`, `windows`, `ios`, or `android`. `mobileStyle` accepts any named preset. With a fixed style it applies at the760px host breakpoint; with `auto` it overrides the selected visitor's compact/portrait rule. Explicit presets remain fixed across rotation unless a mobile override is supplied. Resizing swaps shell controls while preserving running applications, files and drafts. Set these options when mounting; changing React props does not remount a running desktop.

The presets adapt browser UI and existing DindbOS actions. They do not emulate a native operating system. Custom `ui.slots` continue to own their slot content and may need styles appropriate to the chosen preset. See the official-source design notes for [Windows](platform-windows.md), [iOS](platform-ios.md), and [Samsung-inspired Android](platform-android.md).

The local demo defaults to automatic selection and accepts `?style=windows`, `?style=ios`, `?style=android`, or `?style=windows&mobileStyle=ios` for comparison. Mobile presets are designed for compact layouts; forcing one in a wide host is supported for consumer previews.

Mobile Files shows a compact current-path row. The parent-path and Locations controls open a host-contained sheet with ancestors, existing Favorites and other locations. Keyboard dismissal restores focus, navigation focuses the current folder, failed mounted-folder navigation keeps the original path, and the sheet does not block sibling hosts or protected prompts.

## Appearance

Pass the initial appearance in `theme`:

```jsx
<DindbOSDesktop theme={{
  mode: "system",
  accent: "#287a58",
  wallpaper: "meadow",
  dockSize: 52,
}} />
```

Modes are `light`, `dark`, and `system`. Preset wallpapers are `meadow`, `coast`, `dusk`, and `graphite`; a CSS background value is also accepted. Dock size is 36–72 pixels. A host runtime can update these values through `os.setAppearance(patch)`. Settings uses the same appearance state.

For more control, use `theme.variables` and a scoped class:

```js
const theme = {
  className: "studio-desktop",
  variables: { "--content-bg": "#fbfcf9", "--window-radius": "12px" },
};
```

For example, replace the wallpaper and Dock material without replacing its controls:

```js
const theme = {
  wallpaper: 'url("/images/studio.jpg") center / cover',
  dockSize: 48,
  variables: {
    "--dock-background": "#24332f",
    "--dock-border": "1px solid #7c978b",
    "--dock-radius": "12px",
    "--dock-shadow": "0 4px 16px #0004",
    "--dock-gap": "8px",
    "--dock-padding": "6px 10px 10px",
    "--dock-bottom": "12px",
  },
};
```

Pass this `theme` to `mountDindbOSDesktop({ root, theme })` or `<DindbOSDesktop theme={theme} />`. Image paths resolve from the embedding page; use your own asset URL, including a full URL when needed. Values are CSS strings, so dimensions need units. Each desktop owns its variables.

| Dock token | Controls |
| --- | --- |
| `--dock-background` | Full CSS background, including in light/dark and refracted/frosted glass modes |
| `--dock-border` | Full border shorthand |
| `--dock-radius` | Corner radius |
| `--dock-shadow` | Box shadow |
| `--dock-gap` | Space between icons |
| `--dock-padding` | Inner space |
| `--dock-bottom` | Distance from the bottom of the desktop |

Omit a token to retain the standard responsive appearance. These tokens keep the existing Dock actions, tooltips, running indicators and keyboard controls. Reduced transparency and forced colors retain their accessible opaque material, overriding custom background and shadow. For an entirely different layout, use `ui.slots.dock` below.

Shared tokens are described in [DESIGN.md](../DESIGN.md). Prefer public tokens over selecting private descendant markup. Scope your own app styles, too.

## Icons

Use an included icon name such as `folder`, `terminal`, `calculator`, or `app`, an image URL, or a React element in a React app declaration. Give the app a readable name; the name supplies the launcher's accessible label. Use artwork you have permission to distribute.

## Choose built-in apps

```js
const builtins = {
  includePortfolio: false,
  exclude: ["browser", "activity-monitor"],
};
```

Use `include` to select specific IDs, or `exclude` to remove defaults. Inspect the installed app registry for IDs rather than guessing a display name. Exclude a builtin before registering your own replacement with the same ID.

## Window layouts

App definitions and `<DindbOSApp>` accept `chrome`, `sidebarWidth`, `minWidth` and `minHeight`:

```js
const app = defineApp({
  id: "library",
  chrome: "integrated",
  sidebarWidth: 180,
  minWidth: 480,
  minHeight: 320,
  render({ content }) {
    content.innerHTML = `<section class="library"><header data-window-drag>Library</header><main>…</main></section>`;
  },
});
```

`standard` keeps the default title bar, `document` uses a compact 28px bar, and `integrated` places the window controls over your app's first 52px. In an integrated layout reserve the top-left `sidebarWidth` (90px by default) for window controls. Mark your own toolbar with `data-window-drag`; interactive form elements remain clickable. Use `data-no-drag` for additional custom interactive regions. The runtime retains close, minimize, maximize, resize, focus and saved placement behavior. Declared minimum sizes are bounded by the available desktop workspace.

## Replace a desktop surface

`ui.slots` supports `desktop`, `menubar`, `dock`, and `windowChrome`. Each renderer receives one object: `{ element, state, actions, defaultRender }`. It can mount into `element` and return a cleanup function. `defaultRender()` mounts the standard UI into that element.

```js
const ui = {
  slots: {
    menubar({ element, defaultRender }) {
      defaultRender();
      element.dataset.brand = "studio";
      return () => { delete element.dataset.brand; };
    },
  },
};
```

Use the supplied `state` and `actions` when building a replacement. Their members depend on the surface. Check the public types and the corresponding slot implementation before replacing controls. Do not create a second source of truth for active windows or app execution. Remove event listeners, observers, and third-party roots in the returned cleanup.

## Files, storage, and host boundaries

`fileSystem` seeds the virtual filesystem; it is not access to the visitor's real disk. `storage.name` separates independent desktops. Use `backend: "memory"` for temporary examples. Persisted data may override seed files on later visits, so do not reset storage just to refresh a demo.

The host container controls the desktop's size. Your existing page and sibling desktops should retain their own styles, scroll, and keyboard behavior. Test both a full-screen host and a small embedded host after a custom UI change.

## Refractive glass

Floating shell surfaces use the instance-owned [Liquid Glass adapter](liquid-glass.md). Set `ui.liquidGlass` to `false` to retain the ordinary theme material, or configure `{ strength: 1, blur: 0.6, maxSurfaces: 18 }`. Mark custom chrome with `data-glass-surface` to opt in. The adapter follows desktop cleanup and honors reduced transparency; desktop Chromium provides refraction and Safari/Firefox use a frosted fallback.

## Menus for your app

Declare `menus` on `defineApp`, `DindbOSApp`, a class app, or React `DindbOSApp`. Its optional `file`, `edit`, `view`, and `help` arrays replace the corresponding menu for the active app; use `null` as a separator and `[]` to hide a menu. Omitted menus keep the built-in defaults. Unknown apps receive a neutral File → Close Window fallback.

```js
const editor = defineApp({
  id: "studio-editor",
  name: "Studio Editor",
  menus: ({ content }) => ({
    file: [{
      label: "Save Draft",
      accelerator: "Mod+Shift+S",
      enabled: () => Boolean(content.querySelector("textarea")?.value),
      run: async ({ content, os }) => {
        await os.fs.writeFile("/home/guest/draft.txt", content.querySelector("textarea").value);
      },
    }],
    view: [],
  }),
  render: ({ content }) => { content.innerHTML = "<textarea aria-label='Draft'></textarea>"; },
});
```

A factory and each command receive the same app context as `render`, including its sandboxed `os`, content element, window API, and launch context. Factories and `enabled` callbacks must be synchronous; `run` may return a promise. Commands opened for one window stay attached to that window even if focus changes. Closing the window invalidates its commands. Menu callbacks that fail report an error without taking down the desktop.

`accelerator` installs an instance-scoped keyboard command (`Mod` means Command or Control). `shortcut` is an optional display label only; it does not install a listener. Accelerators pause while a shell panel or a modal belonging to that desktop is open. `checked` displays a checkmark and `enabled: false` disables an item. Browser and operating-system reserved shortcuts may take precedence. Menus are host SDK metadata and are not serialized into installable app manifests.
