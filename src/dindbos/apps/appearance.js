const ACCENTS = [
  ["Green", "#287a58"], ["Blue", "#2676d9"], ["Purple", "#9b59b6"],
  ["Pink", "#d35a8b"], ["Orange", "#cf7429"], ["Graphite", "#717780"],
];
const WALLPAPERS = [["meadow", "Meadow"], ["coast", "Coast"], ["dusk", "Dusk"], ["graphite", "Graphite"]];

export function appearanceMarkup(appearance = {}) {
  const mode = appearance.mode || "system";
  const wallpaper = appearance.wallpaper || "meadow";
  return `
    <div class="appearance-settings">
      <h3>Appearance</h3>
      <div class="appearance-modes" role="group" aria-label="Appearance mode">
        ${[["light", "Light"], ["dark", "Dark"], ["system", "Auto"]].map(([id, label]) => `
          <button class="appearance-mode" type="button" data-appearance-mode="${id}" aria-pressed="${mode === id}">
            <span class="appearance-mode-preview" data-preview-mode="${id}" aria-hidden="true"><i></i><i></i><i></i></span>
            <span>${label}</span>
          </button>`).join("")}
      </div>
      <div class="appearance-setting-row">
        <div><strong>Accent color</strong><span>Buttons, selection, and focus</span></div>
        <div class="appearance-accents" role="group" aria-label="Accent color">
          ${ACCENTS.map(([label, color]) => `<button type="button" class="appearance-swatch" data-appearance-accent="${color}" style="--swatch:${color}" aria-label="${label}" aria-pressed="${appearance.accent === color || (!appearance.accent && label === "Green")}"></button>`).join("")}
        </div>
      </div>
      <div class="appearance-setting-row appearance-wallpaper-row">
        <div><strong>Wallpaper</strong><span>A different view for your workspace</span></div>
        <div class="appearance-wallpapers" role="group" aria-label="Wallpaper">
          ${WALLPAPERS.map(([id, label]) => `<button type="button" class="appearance-wallpaper" data-appearance-wallpaper="${id}" aria-pressed="${wallpaper === id}"><span class="appearance-wallpaper-preview" data-wallpaper-preview="${id}" aria-hidden="true"></span><span>${label}</span></button>`).join("")}
        </div>
      </div>
      <label class="appearance-setting-row" >
        <div><strong>Dock size</strong><span>Small <span aria-hidden="true">—</span> Large</span></div>
        <input data-appearance-dock type="range" min="36" max="72" step="2" value="${Math.max(36, Math.min(72, Number(appearance.dockSize) || 52))}" aria-label="Dock size" />
      </label>
    </div>`;
}

export function wireAppearanceControls(content, bridge) {
  const update = (appearance = {}) => {
    for (const button of content.querySelectorAll("[data-appearance-mode]")) button.setAttribute("aria-pressed", String(button.dataset.appearanceMode === (appearance.mode || "system")));
    for (const button of content.querySelectorAll("[data-appearance-accent]")) button.setAttribute("aria-pressed", String(button.dataset.appearanceAccent === (appearance.accent || "#287a58")));
    for (const button of content.querySelectorAll("[data-appearance-wallpaper]")) button.setAttribute("aria-pressed", String(button.dataset.appearanceWallpaper === (appearance.wallpaper || "meadow")));
    const dock = content.querySelector("[data-appearance-dock]");
    if (dock && dock !== dock.ownerDocument.activeElement) dock.value = String(appearance.dockSize || 52);
  };
  const onClick = (event) => {
    const button = event.target.closest("[data-appearance-mode],[data-appearance-accent],[data-appearance-wallpaper]");
    if (!button || !content.contains(button)) return;
    if (button.dataset.appearanceMode) bridge.set({ mode: button.dataset.appearanceMode });
    if (button.dataset.appearanceAccent) bridge.set({ accent: button.dataset.appearanceAccent });
    if (button.dataset.appearanceWallpaper) bridge.set({ wallpaper: button.dataset.appearanceWallpaper });
  };
  const onInput = (event) => {
    if (event.target.matches("[data-appearance-dock]")) bridge.set({ dockSize: Number(event.target.value) });
  };
  content.addEventListener("click", onClick);
  content.addEventListener("input", onInput);
  update(bridge.get());
  const unsubscribe = bridge.subscribe(update);
  return () => {
    content.removeEventListener("click", onClick);
    content.removeEventListener("input", onInput);
    unsubscribe?.();
  };
}

export function welcomeMarkup(appearance = {}) {
  return `
    <section class="welcome-app">
      <header class="welcome-heading"><span class="welcome-symbol" aria-hidden="true">D</span><h1>Your web. Your desktop.</h1><p>A familiar workspace, made from the components you already build.</p></header>
      <nav class="welcome-apps" aria-label="Explore built-in apps">
        ${[["files", "Files", "Browse your workspace"], ["terminal", "Terminal", "Run a command"], ["calculator", "Calculator", "Work something out"], ["settings", "Settings", "Make yourself at home"]].map(([id, name, detail]) => `<button type="button" data-welcome-launch="${id}"><span class="welcome-app-art" data-welcome-icon="${id}" aria-hidden="true"></span><strong>${name}</strong><span>${detail}</span></button>`).join("")}
      </nav>
      <div class="welcome-customize">${appearanceMarkup(appearance)}</div>
      <section class="welcome-code"><h2>Bring your own app</h2><p>Keep your React components, state, and context. Give them a window.</p><pre><code>import { DindbOSDesktop, DindbOSApp } from "dindbos/react";
import "dindbos/styles.css";

&lt;DindbOSDesktop launch={["hello"]}&gt;
  &lt;DindbOSApp id="hello" name="Hello"&gt;
    &lt;YourComponent /&gt;
  &lt;/DindbOSApp&gt;
&lt;/DindbOSDesktop&gt;</code></pre></section>
      <footer class="welcome-footer"><span>DindbOS · Open source</span><a href="https://github.com/Dindb-dong/dindbos" target="_blank" rel="noopener noreferrer">Documentation ↗</a></footer>
    </section>`;
}
