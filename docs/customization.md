# Customize your desktop

The host owns app content and appearance. The runtime owns execution, permissions, virtual files, and window state. Keep that boundary when replacing a view.

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

Shared tokens are described in [DESIGN.md](../DESIGN.md). Prefer public tokens over selecting private descendant markup. Scope your own app styles, too.

## Icons

Use an included icon name such as `folder`, `terminal`, `calculator`, or `app`, an image URL, or a React element in a React app declaration. Give the app a readable name; the name supplies the launcher's accessible label. Use artwork you have permission to distribute.

## Choose built-in apps

```js
const builtins = {
  includePortfolio: false,
  includeWelcome: true,
  exclude: ["browser", "activity-monitor"],
};
```

Use `include` to select specific IDs, or `exclude` to remove defaults. Inspect the installed app registry for IDs rather than guessing a display name. Exclude a builtin before registering your own replacement with the same ID. The Welcome app is opt-in.

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
