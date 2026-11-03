import { WALLPAPERS as WALLPAPER_BACKGROUNDS } from "../appearance.js";
const ACCENTS = [
  ["Green", "#287a58"], ["Blue", "#2676d9"], ["Purple", "#9b59b6"],
  ["Pink", "#d35a8b"], ["Orange", "#cf7429"], ["Graphite", "#717780"],
];
const WALLPAPERS = [["meadow", "Meadow"], ["coast", "Coast"], ["dusk", "Dusk"], ["graphite", "Graphite"]];

export function appearanceMarkup(appearance = {}, { wallpaper: showWallpaper = true, dock: showDock = true } = {}) {
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
      ${showWallpaper ? `<div class="appearance-setting-row appearance-wallpaper-row">
        <div><strong>Wallpaper</strong><span>A different view for your workspace</span></div>
        <div class="appearance-wallpapers" role="group" aria-label="Wallpaper">
          ${WALLPAPERS.map(([id, label]) => `<button type="button" class="appearance-wallpaper" data-appearance-wallpaper="${id}" aria-pressed="${wallpaper === id}"><span class="appearance-wallpaper-preview" data-wallpaper-preview="${id}" aria-hidden="true"></span><span>${label}</span></button>`).join("")}
        </div>
      </div>` : ""}
      ${showDock ? `<label class="appearance-setting-row" >
        <div><strong>Dock size</strong><span>Small <span aria-hidden="true">—</span> Large</span></div>
        <input data-appearance-dock type="range" min="36" max="72" step="2" value="${Math.max(36, Math.min(72, Number(appearance.dockSize) || 52))}" aria-label="Dock size" />
      </label>` : ""}
    </div>`;
}

export function wireAppearanceControls(content, bridge) {
  const update = (appearance = {}) => {
    for (const button of content.querySelectorAll("[data-appearance-mode]")) button.setAttribute("aria-pressed", String(button.dataset.appearanceMode === (appearance.mode || "system")));
    for (const button of content.querySelectorAll("[data-appearance-accent]")) button.setAttribute("aria-pressed", String(button.dataset.appearanceAccent === (appearance.accent || "#287a58")));
    for (const button of content.querySelectorAll("[data-appearance-wallpaper]")) button.setAttribute("aria-pressed", String(button.dataset.appearanceWallpaper === (appearance.wallpaper || "meadow")));
    const selectedWallpaper = appearance.wallpaper || "meadow";
    const currentPreview = content.querySelector("[data-settings-wallpaper-current]");
    if (currentPreview) currentPreview.style.background = WALLPAPER_BACKGROUNDS[selectedWallpaper] || selectedWallpaper;
    const currentName = content.querySelector("[data-settings-wallpaper-name]");
    if (currentName) currentName.textContent = WALLPAPERS.find(([id]) => id === selectedWallpaper)?.[1] || "Custom Wallpaper";
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
  let disposed = false;
  let uploadVersion = 0;
  const upload = content.querySelector("[data-wallpaper-upload]");
  const addPhoto = content.querySelector("[data-wallpaper-add]");
  const uploadError = content.querySelector("[data-wallpaper-upload-error]");
  const setUploadError = (message = "") => {
    if (!uploadError || disposed) return;
    uploadError.textContent = message;
    uploadError.hidden = !message;
  };
  const onAddPhoto = () => upload?.click();
  const onPhoto = async () => {
    const file = upload.files?.[0];
    if (!file || disposed) return;
    const version = ++uploadVersion;
    setUploadError();
    addPhoto.disabled = true;
    addPhoto.setAttribute("aria-busy", "true");
    try {
      const background = await importWallpaperPhoto(file, () => disposed || version !== uploadVersion);
      if (!disposed && version === uploadVersion) bridge.set({ wallpaper: background });
    } catch (error) {
      if (!disposed && version === uploadVersion) setUploadError(error.message || "This photo could not be opened.");
    } finally {
      if (!disposed && version === uploadVersion) {
        addPhoto.disabled = false;
        addPhoto.removeAttribute("aria-busy");
        upload.value = "";
      }
    }
  };
  addPhoto?.addEventListener("click", onAddPhoto);
  upload?.addEventListener("change", onPhoto);
  const onInput = (event) => {
    if (event.target.matches("[data-appearance-dock]")) bridge.set({ dockSize: Number(event.target.value) });
  };
  content.addEventListener("click", onClick);
  content.addEventListener("input", onInput);
  update(bridge.get());
  const unsubscribe = bridge.subscribe(update);
  return () => {
    disposed = true;
    uploadVersion++;
    addPhoto?.removeEventListener("click", onAddPhoto);
    upload?.removeEventListener("change", onPhoto);
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
        ${[["files", "Files", "Browse your workspace"], ["notes", "Notes", "Capture a thought"], ["reminders", "Reminders", "Plan what comes next"], ["calendar", "Calendar", "Make time for it"], ["photos", "Photos", "Your image library"], ["music", "Music", "Listen to your files"], ["clock", "Clock", "Keep track of time"], ["settings", "Settings", "Make yourself at home"]].map(([id, name, detail]) => `<button type="button" data-welcome-launch="${id}"><span class="welcome-app-art" data-welcome-icon="${id}" aria-hidden="true"></span><strong>${name}</strong><span>${detail}</span></button>`).join("")}
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

export function wallpaperSettingsMarkup(appearance = {}) {
  const wallpaper = appearance.wallpaper || "meadow";
  const currentName = WALLPAPERS.find(([id]) => id === wallpaper)?.[1] || "Custom Wallpaper";
  return `<section class="settings-wallpaper-page">
    <div class="settings-wallpaper-current">
      <div class="settings-wallpaper-display" data-settings-wallpaper-current role="img" aria-label="Current desktop wallpaper"></div>
      <div class="settings-wallpaper-summary"><h3 data-settings-wallpaper-name>${currentName}</h3><p>Your desktop wallpaper</p><span>Fills the desktop</span></div>
    </div>
    <section class="settings-wallpaper-collection"><header><h3>Wallpapers</h3><span>${WALLPAPERS.length} backgrounds</span></header>
      <div class="settings-wallpaper-gallery" role="group" aria-label="Wallpaper">
      ${WALLPAPERS.map(([id, label]) => `<button type="button" class="settings-wallpaper-choice" data-appearance-wallpaper="${id}" aria-pressed="${wallpaper === id}"><span class="settings-wallpaper-image" data-settings-wallpaper-image="${id}" aria-hidden="true"></span><span>${label}</span><span class="settings-wallpaper-selected" aria-hidden="true">✓</span></button>`).join("")}
      </div>
    </section>
    <section class="settings-wallpaper-collection settings-wallpaper-photos"><header><h3>Your Photo</h3></header>
      <button type="button" class="settings-wallpaper-add" data-wallpaper-add><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="23" height="20" rx="3"/><circle cx="10" cy="11" r="2"/><path d="m4 21 7-7 6 6m3 4h10m-5-5v10"/></svg><span>Add Photo…</span></button>
      <input type="file" data-wallpaper-upload accept="image/png,image/jpeg,image/webp" aria-label="Choose wallpaper photo" hidden>
      <p class="settings-wallpaper-photo-note">PNG, JPEG, or WebP. A resized copy is used for this desktop.</p>
      <p class="settings-wallpaper-upload-error" data-wallpaper-upload-error role="alert" hidden></p>
    </section>
  </section>`;
}

export function desktopSettingsMarkup(appearance = {}) {
  return `<section class="settings-desktop-page"><div class="settings-dock-preview" aria-hidden="true">${["files", "applications", "notes", "photos", "settings"].map(icon=>`<span data-settings-dock-icon="${icon}"></span>`).join("")}</div>
    <div class="settings-preference-group"><label class="settings-dock-size"><strong>Dock size</strong><span class="settings-dock-range"><span>Small</span><input data-appearance-dock type="range" min="36" max="72" step="2" value="${Math.max(36, Math.min(72, Number(appearance.dockSize) || 52))}" aria-label="Dock size"><span>Large</span></span></label></div>
    <p class="settings-page-note">Use an app’s Dock menu to keep or remove it. Open apps can be restored from their Dock icons.</p></section>`;
}

export function wireWallpaperPreviews(content) {
  for (const preview of content.querySelectorAll("[data-settings-wallpaper-image]")) preview.style.background = WALLPAPER_BACKGROUNDS[preview.dataset.settingsWallpaperImage];
}

/** Bounded local image import; the caller owns applying the resulting preference. */
export async function importWallpaperPhoto(file, canceled = () => false) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG, or WebP photo.");
  if (!file.size || file.size > 16 * 1024 * 1024) throw new Error("Choose a photo smaller than 16 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw new Error("This photo could not be opened. Choose another image."); }
    if (canceled()) return null;
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("Choose a photo with fewer than 40 million pixels.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare this photo.");
    context.fillStyle = "#eef1ef";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let result;
    for (const quality of [.86, .72, .56, .4]) {
      result = canvas.toDataURL("image/jpeg", quality);
      if (result.length <= 500_000) break;
    }
    if (result.length > 500_000) {
      const smaller = document.createElement("canvas");
      smaller.width = Math.max(1, Math.round(canvas.width * .65));
      smaller.height = Math.max(1, Math.round(canvas.height * .65));
      const smallContext = smaller.getContext("2d");
      if (!smallContext) throw new Error("Your browser could not prepare this photo.");
      smallContext.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      result = smaller.toDataURL("image/jpeg", .6);
    }
    if (!result.startsWith("data:image/jpeg;") || result.length > 500_000) throw new Error("This photo is too detailed. Choose a smaller image.");
    return canceled() ? null : `url("${result}")`;
  } finally { URL.revokeObjectURL(url); }
}
