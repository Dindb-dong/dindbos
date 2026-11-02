import { fileContentToBytes } from "../file-data.js";

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_LIBRARY_FILES = 256;
const MAX_LIBRARY_BYTES = 128 * 1024 * 1024;
const escape = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const glyphs = {
  import: '<path d="M10 2v11m-4-4 4 4 4-4M3 14v4h14v-4"/>',
  grid: '<rect x="2" y="2" width="6" height="6" rx="1"/><rect x="12" y="2" width="6" height="6" rx="1"/><rect x="2" y="12" width="6" height="6" rx="1"/><rect x="12" y="12" width="6" height="6" rx="1"/>',
  back: '<path d="m12 4-6 6 6 6"/>', next: '<path d="m8 4 6 6-6 6"/>',
  trash: '<path d="M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v7m4-7v7"/>',
  photo: '<rect x="2" y="3" width="16" height="14" rx="2"/><circle cx="7" cy="7" r="1.5"/><path d="m3 15 5-5 4 4 3-3 3 4"/>',
  music: '<path d="M8 15V4l9-2v11M8 8l9-2"/><ellipse cx="5" cy="15" rx="3" ry="2"/><ellipse cx="14" cy="13" rx="3" ry="2"/>',
  play: '<path d="m6 3 11 7-11 7Z"/>', pause: '<path d="M6 3v14M14 3v14"/>',
  previous: '<path d="M4 4v12m12-12L6 10l10 6Z"/>', skip: '<path d="M16 4v12M4 4l10 6-10 6Z"/>',
};
const icon = (name) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name] || glyphs.photo}</svg>`;
const tool = (action, label, name = action) => `<button type="button" data-media-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`;

function mediaLibrary(os, kind, prefix) {
  const home = os.session.home || "/home/guest";
  const directory = os.fs.join(home, kind, `${prefix} Library`);
  const urls = new Map();
  const ensure = (path) => {
    if (os.fs.exists(path)) return;
    const parent = os.fs.dirname(path);
    if (parent !== path) ensure(parent);
    os.fs.createDirectory(path);
  };
  ensure(directory);
  return {
    directory,
    list: () => os.fs.list(directory).filter((node) => node.type === "file").sort((a, b) => a.name.localeCompare(b.name)),
    url(node) {
      if (!urls.has(node.path)) urls.set(node.path, URL.createObjectURL(new Blob([os.fs.readFileBytes ? os.fs.readFileBytes(node.path) : fileContentToBytes(os.fs.readFile(node.path))], { type: node.mime || "application/octet-stream" })));
      return urls.get(node.path);
    },
    async import(files, alive) {
      let imported = 0;
      try {
        for (const file of files) {
          if (!alive()) break;
          const image = prefix === "Photos";
          const valid = image ? /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)$/.test(file.type) || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name) : file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|flac|webm)$/i.test(file.name);
          if (!valid) throw new Error(`${file.name}: choose ${image ? "an image" : "an audio file"}.`);
          if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: files must be 32 MB or smaller.`);
          if (this.list().length >= MAX_LIBRARY_FILES) throw new Error("This library can hold 256 files. Move an item to Trash before importing more.");
          const totalBytes = this.list().reduce((total, node) => total + (os.fs.stat(node.path).size || 0), 0);
          if (totalBytes + file.size > MAX_LIBRARY_BYTES) throw new Error("This library is limited to 128 MB. Move an item to Trash before importing more.");
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!alive()) break;
          const name = file.name.replace(/[\\/\u0000-\u001f]/g, "-") || `${prefix.toLowerCase()}-${Date.now()}`;
          const dot = name.lastIndexOf(".");
          const stem = dot > 0 ? name.slice(0, dot) : name;
          const extension = dot > 0 ? name.slice(dot) : "";
          let path = os.fs.join(directory, name);
          let suffix = 2;
          while (os.fs.exists(path)) path = os.fs.join(directory, `${stem} ${suffix++}${extension}`);
          const fallbackMime = image ? ({ jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml" }[extension.slice(1).toLowerCase()] || `image/${extension.slice(1).toLowerCase()}`) : ({ mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac", webm: "audio/webm" }[extension.slice(1).toLowerCase()] || "audio/mpeg");
          os.fs.createFile(path, "/", { content: bytes, mime: file.type || fallbackMime });
          imported++;
        }
      } finally { if (imported) await os.storage?.sync?.(); }
      return imported;
    },
    async trash(node) {
      const trash = os.fs.join(home, ".Trash");
      ensure(trash);
      let target = os.fs.join(trash, node.name);
      let suffix = 2;
      while (os.fs.exists(target)) target = os.fs.join(trash, `${suffix++}-${node.name}`);
      os.fs.move(node.path, target);
      const url = urls.get(node.path);
      if (url) URL.revokeObjectURL(url);
      urls.delete(node.path);
      await os.storage?.sync?.();
    },
    dispose() { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); },
  };
}

function mediaFeedback(content, controller) {
  let timer;
  return {
    show(message, error = false) {
      if (controller.signal.aborted) return;
      clearTimeout(timer);
      const node = content.querySelector("[data-media-feedback]");
      node.hidden = false;
      node.textContent = message;
      const dismiss = node.ownerDocument.createElement("button");
      dismiss.type = "button"; dismiss.className = "media-feedback-dismiss"; dismiss.setAttribute("aria-label", "Dismiss message"); dismiss.textContent = "×"; dismiss.onclick = () => { node.hidden = true; }; node.appendChild(dismiss);
      node.setAttribute("role", error ? "alert" : "status");
      if (!error) timer = setTimeout(() => { node.hidden = true; }, 3200);
    },
    dispose() { clearTimeout(timer); },
  };
}

export function renderPhotos(os, content, context = {}, windowApi = {}) {
  const controller = new AbortController();
  const library = mediaLibrary(os, "Pictures", "Photos");
  const feedback = mediaFeedback(content, controller);
  let selected = null;
  let viewer = false;
  let zoom = 1;
  let importing = false;
  content.innerHTML = `<section class="media-app photos-app" tabindex="-1"><aside class="media-sidebar"><h2>Photos</h2><button type="button" class="is-selected" data-media-action="library">${icon("photo")}<span>Library</span><small data-photo-count>0</small></button><p>Your imported photos stay on this desktop.</p></aside><main class="media-main"><header class="media-toolbar"><div class="media-toolbar-title"><strong data-photo-title>Library</strong><small data-photo-subtitle>All Photos</small></div><div class="media-toolbar-actions">${tool("gallery", "Show photo grid", "grid")}${tool("previous", "Previous photo", "back")}${tool("next", "Next photo")}${tool("trash", "Move photo to Trash")}${tool("import", "Import photos")}</div></header><div class="media-feedback" data-media-feedback hidden></div><div class="photo-grid" aria-label="Photo library"></div><div class="photo-viewer" hidden><div class="photo-image-scroll"><img alt="" /></div><footer><button type="button" data-media-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-media-action="fit">Fit</button><button type="button" data-media-action="zoom-in" aria-label="Zoom in">+</button><span data-photo-dimensions></span></footer></div><footer class="media-library-footer" data-photo-footer></footer></main><input data-media-input type="file" accept="image/*" multiple hidden /></section>`;
  const root = content.querySelector(".photos-app");
  const grid = root.querySelector(".photo-grid");
  const image = root.querySelector(".photo-viewer img");
  const input = root.querySelector("input");
  const items = () => library.list();
  const refresh = () => {
    if (controller.signal.aborted) return;
    const entries = items();
    if (selected && !entries.some((node) => node.path === selected.path) && selected.library !== false) { selected = null; viewer = false; }
    root.querySelector("[data-photo-count]").textContent = entries.length;
    root.querySelector("[data-photo-footer]").textContent = `${entries.length} ${entries.length === 1 ? "photo" : "photos"}`;
    root.querySelector("[data-photo-title]").textContent = viewer && selected ? selected.name : "Library";
    root.querySelector("[data-photo-subtitle]").textContent = viewer ? "Photo" : "All Photos";
    root.querySelector('[data-media-action="gallery"]').hidden = !viewer;
    root.querySelectorAll('[data-media-action="previous"], [data-media-action="next"]').forEach((button) => { button.hidden = !viewer; button.disabled = entries.length < 2; });
    root.querySelector('[data-media-action="trash"]').disabled = !selected || selected.library === false;
    grid.hidden = viewer;
    root.querySelector(".photo-viewer").hidden = !viewer;
    if (viewer && selected) {
      image.src = library.url(selected);
      image.alt = selected.name;
      applyZoom();
    } else {
      grid.innerHTML = entries.length ? entries.map((node) => `<button type="button" class="photo-tile${selected?.path === node.path ? " is-selected" : ""}" data-photo-path="${escape(node.path)}" aria-label="Open ${escape(node.name)}" aria-pressed="${selected?.path === node.path}"><img src="${escape(library.url(node))}" alt="" loading="lazy"/><span>${escape(node.name)}</span></button>`).join("") : `<div class="media-empty">${icon("photo")}<h2>Your photo library</h2><p>Import images to collect and view them here.</p><button type="button" data-media-action="import">Import Photos…</button></div>`;
    }
    windowApi.setTitle?.(viewer && selected ? `${selected.name} — Photos` : "Photos");
  };
  const applyZoom = () => {
    image.style.width = zoom === 1 ? "100%" : `${zoom * 100}%`;
    image.style.height = zoom === 1 ? "100%" : "auto";
    image.style.maxWidth = zoom === 1 ? "100%" : "none";
    image.style.objectFit = "contain";
    root.querySelector('[data-media-action="fit"]').textContent = zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}% · Fit`;
  };
  const step = (direction) => {
    const entries = items();
    if (!entries.length) return;
    const index = entries.findIndex((node) => node.path === selected?.path);
    selected = entries[(index + direction + entries.length) % entries.length];
    zoom = 1; viewer = true; refresh();
  };
  root.addEventListener("click", async (event) => {
    const tile = event.target.closest("[data-photo-path]");
    if (tile) { selected = items().find((node) => node.path === tile.dataset.photoPath); viewer = true; zoom = 1; refresh(); return; }
    const action = event.target.closest("[data-media-action]")?.dataset.mediaAction;
    if (!action) return;
    try {
      if (action === "import") input.click();
      else if (action === "gallery" || action === "library") { viewer = false; refresh(); }
      else if (action === "previous") step(-1);
      else if (action === "next") step(1);
      else if (action === "zoom-in" || action === "zoom-out") { zoom = Math.max(.25, Math.min(4, zoom + (action === "zoom-in" ? .25 : -.25))); applyZoom(); }
      else if (action === "fit") { zoom = 1; applyZoom(); }
      else if (action === "trash" && selected && selected.library !== false) { await library.trash(selected); selected = null; viewer = false; refresh(); feedback.show("Photo moved to Trash"); }
    } catch (error) { refresh(); feedback.show(error.message, true); }
  }, { signal: controller.signal });
  input.addEventListener("change", async () => {
    if (importing) return;
    importing = true;
    root.querySelectorAll('[data-media-action="import"]').forEach((button) => { button.disabled = true; });
    try { const count = await library.import([...input.files], () => !controller.signal.aborted); refresh(); feedback.show(`${count} ${count === 1 ? "photo" : "photos"} imported`); }
    catch (error) { refresh(); feedback.show(error.message, true); }
    finally { importing = false; input.value = ""; root.querySelectorAll('[data-media-action="import"]').forEach((button) => { button.disabled = false; }); }
  }, { signal: controller.signal });
  image.addEventListener("load", () => { root.querySelector("[data-photo-dimensions]").textContent = `${image.naturalWidth} × ${image.naturalHeight}`; }, { signal: controller.signal });
  image.addEventListener("error", () => feedback.show("This image could not be decoded. Try PNG, JPEG, or WebP.", true), { signal: controller.signal });
  root.addEventListener("keydown", (event) => {
    if (!viewer) return;
    if (["Escape", "ArrowLeft", "ArrowRight", "+", "-"].includes(event.key)) event.preventDefault();
    if (event.key === "Escape") { viewer = false; refresh(); }
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
    if (event.key === "+" || event.key === "-") { zoom = Math.max(.25, Math.min(4, zoom + (event.key === "+" ? .25 : -.25))); applyZoom(); }
  }, { signal: controller.signal });
  if (context.node?.path) { selected = { ...context.node, library: false }; viewer = true; }
  try { refresh(); }
  catch (error) { controller.abort(); feedback.dispose(); library.dispose(); image.removeAttribute("src"); throw error; }
  return () => { controller.abort(); feedback.dispose(); library.dispose(); image.removeAttribute("src"); };
}

const formatTime = (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "0:00";
export function renderMusic(os, content, context = {}, windowApi = {}) {
  const controller = new AbortController();
  const library = mediaLibrary(os, "Music", "Music");
  const feedback = mediaFeedback(content, controller);
  let selected = null;
  let importing = false;
  content.innerHTML = `<section class="media-app music-app" tabindex="-1"><aside class="media-sidebar"><h2>Music</h2><button type="button" class="is-selected">${icon("music")}<span>Songs</span><small data-music-count>0</small></button><p>Play audio imported from your device.</p></aside><main class="media-main"><header class="media-toolbar"><div class="media-toolbar-title"><strong>Songs</strong><small>Your library</small></div><div class="media-toolbar-actions">${tool("trash", "Move song to Trash")}${tool("import", "Import audio")}</div></header><div class="media-feedback" data-media-feedback hidden></div><div class="music-library" aria-label="Song library"></div><footer class="music-player"><div class="music-now-playing"><span class="music-artwork">${icon("music")}</span><div><strong data-music-title>Not Playing</strong><small data-music-detail>Choose a song from your library</small></div></div><div class="music-playback"><div class="music-transport">${tool("previous", "Previous song")}${tool("play", "Play", "play")}${tool("next", "Next song", "skip")}</div><div class="music-timeline"><span data-music-elapsed>0:00</span><input type="range" aria-label="Playback position" min="0" max="100" step=".1" value="0" disabled /><span data-music-duration>0:00</span></div></div><label class="music-volume">Volume<input type="range" aria-label="Volume" min="0" max="1" step=".05" value=".7" /></label></footer><audio preload="metadata"></audio></main><input data-media-input type="file" accept="audio/*" multiple hidden /></section>`;
  const root = content.querySelector(".music-app");
  const list = root.querySelector(".music-library");
  const input = root.querySelector("[data-media-input]");
  const audio = root.querySelector("audio");
  const seek = root.querySelector('[aria-label="Playback position"]');
  const play = root.querySelector('[data-media-action="play"]');
  audio.volume = .7;
  const entries = () => library.list();
  const updatePlayback = () => {
    if (controller.signal.aborted) return;
    play.innerHTML = icon(audio.paused ? "play" : "pause");
    play.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
    play.title = audio.paused ? "Play" : "Pause";
    play.disabled = !selected;
    root.querySelector('[data-media-action="trash"]').disabled = !selected || selected.library === false;
    root.querySelector('[data-media-action="previous"]').disabled = entries().length < 2;
    root.querySelector('[data-media-action="next"]').disabled = entries().length < 2;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    seek.disabled = !duration;
    seek.max = String(duration || 100);
    seek.value = String(audio.currentTime || 0);
    root.querySelector("[data-music-elapsed]").textContent = formatTime(audio.currentTime);
    root.querySelector("[data-music-duration]").textContent = formatTime(duration);
    root.querySelector("[data-music-title]").textContent = selected?.name || "Not Playing";
    root.querySelector("[data-music-detail]").textContent = selected ? audio.paused ? "Paused" : "Playing" : "Choose a song from your library";
  };
  const refresh = () => {
    if (controller.signal.aborted) return;
    const tracks = entries();
    root.querySelector("[data-music-count]").textContent = tracks.length;
    list.innerHTML = tracks.length ? `<div class="music-list-heading"><span>Title</span><span>File type</span></div>${tracks.map((node) => `<button type="button" class="music-track${selected?.path === node.path ? " is-selected" : ""}" data-music-path="${escape(node.path)}" aria-label="Play ${escape(node.name)}" aria-pressed="${selected?.path === node.path}"><span class="music-track-icon">${icon("music")}</span><span>${escape(node.name)}</span><small>${escape((node.mime || "audio").replace("audio/", ""))}</small></button>`).join("")}` : `<div class="media-empty">${icon("music")}<h2>Your music, here</h2><p>Import audio files to start a local library.</p><button type="button" data-media-action="import">Import Audio…</button></div>`;
    updatePlayback();
  };
  const load = async (node, autoplay = true) => {
    if (!node) return;
    if (node.path !== selected?.path) {
      audio.pause(); selected = node; audio.src = library.url(node); audio.load();
    }
    refresh(); windowApi.setTitle?.(`${node.name} — Music`);
    if (autoplay) {
      try { await audio.play(); }
      catch (error) { if (!controller.signal.aborted) feedback.show(error.name === "NotAllowedError" ? "Choose Play to begin playback." : "This audio could not be played. Try MP3, WAV, or AAC.", true); }
    }
  };
  const step = (direction, autoplay = !audio.paused) => {
    const tracks = entries();
    const index = tracks.findIndex((node) => node.path === selected?.path);
    return load(tracks[(index + direction + tracks.length) % tracks.length], autoplay);
  };
  root.addEventListener("click", async (event) => {
    const track = event.target.closest("[data-music-path]");
    try {
      if (track) { await load(entries().find((node) => node.path === track.dataset.musicPath)); return; }
      const action = event.target.closest("[data-media-action]")?.dataset.mediaAction;
      if (action === "import") input.click();
      else if (action === "play") { if (audio.paused) await load(selected); else audio.pause(); }
      else if (action === "previous") await step(-1);
      else if (action === "next") await step(1);
      else if (action === "trash" && selected && selected.library !== false) { const node = selected; audio.pause(); audio.removeAttribute("src"); audio.load(); selected = null; await library.trash(node); refresh(); windowApi.setTitle?.("Music"); feedback.show("Song moved to Trash"); }
    } catch (error) { refresh(); feedback.show(error.message, true); }
  }, { signal: controller.signal });
  input.addEventListener("change", async () => {
    if (importing) return;
    importing = true;
    root.querySelectorAll('[data-media-action="import"]').forEach((button) => { button.disabled = true; });
    try { const count = await library.import([...input.files], () => !controller.signal.aborted); refresh(); feedback.show(`${count} ${count === 1 ? "song" : "songs"} imported`); }
    catch (error) { refresh(); feedback.show(error.message, true); }
    finally { importing = false; input.value = ""; root.querySelectorAll('[data-media-action="import"]').forEach((button) => { button.disabled = false; }); }
  }, { signal: controller.signal });
  for (const name of ["loadedmetadata", "durationchange", "timeupdate", "play", "pause", "ended"]) audio.addEventListener(name, () => { updatePlayback(); if (name === "ended") { const tracks = entries(); const index = tracks.findIndex((node) => node.path === selected?.path); if (index >= 0 && index < tracks.length - 1) load(tracks[index + 1], true); } }, { signal: controller.signal });
  audio.addEventListener("error", () => feedback.show("This audio format could not be decoded by your browser.", true), { signal: controller.signal });
  seek.addEventListener("input", () => { audio.currentTime = Number(seek.value); updatePlayback(); }, { signal: controller.signal });
  root.querySelector('[aria-label="Volume"]').addEventListener("input", (event) => { audio.volume = Number(event.target.value); }, { signal: controller.signal });
  root.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.target.closest("input, button")) return;
    event.preventDefault(); play.click();
  }, { signal: controller.signal });
  refresh();
  if (context.node?.path) load({ ...context.node, library: false }, false).catch((error) => feedback.show(error.message, true));
  return () => { controller.abort(); audio.pause(); audio.removeAttribute("src"); audio.load(); feedback.dispose(); library.dispose(); };
}
