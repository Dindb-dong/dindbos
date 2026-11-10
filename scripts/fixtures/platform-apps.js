import { mountDindbOSDesktop } from "../../src/sdk/desktop.js";

const params = new URLSearchParams(location.search);
const root = document.querySelector("#platform-apps-host");
root.style.width = `${Number(params.get("width")) || 1280}px`;
const os = await mountDindbOSDesktop({
  root,
  ui: { style: params.get("style") || "auto", ...(params.has('mobileStyle') ? { mobileStyle: params.get('mobileStyle') } : {}) },
  theme: { mode: "light" },
  storage: { backend: "memory", name: "platform-apps-evaluation" },
  serviceWorker: false,
  bootstrapPackages: false,
  bootScreen: false,
});

const home = os.session.home;
const principal = os.permissions.systemPrincipal();
for (const relative of ["Documents", "Documents/.dindbos", "Pictures", "Music"]) {
  const path = `${home}/${relative}`;
  if (!os.fs.exists(path)) os.fs.createDirectory(path, "/", { owner: os.session.user, group: "users" }, principal);
}
const seed = (relative, content, mime = "text/plain") => {
  const path = `${home}/${relative}`;
  if (!os.fs.exists(path)) os.fs.createFile(path, "/", { content, mime, owner: os.session.user, group: "users" }, principal);
  return path;
};
if (!os.fs.exists("/etc/motd")) os.fs.createFile("/etc/motd", "/", { content: "DindbOS workspace terminal\n", mime: "text/plain" }, principal);
const today = new Date();
const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
seed("Documents/Project plan.txt", "Project notes\nKeep every existing feature available.\n");
seed("Documents/Welcome.md", "# Workspace guide\n\nA local document for preview and layout evaluation.\n\n- Files and drafts stay on this desktop.\n- Every toolbar action remains available.\n", "text/markdown");
seed("Documents/Start.html", '<!doctype html><html lang="en"><title>Local workspace</title><body style="font:16px system-ui;padding:24px"><h1>Local workspace</h1><p>Rendered from a local HTML file without a remote browser.</p><label>Page draft <input aria-label="Page draft" value="Preserved tab content"></label></body></html>', "text/html");
seed("Documents/.dindbos/notes.json", JSON.stringify([
  { id: "plan", title: "Project plan", body: "Review the platform screens\nKeep the toolbar accessible\nCheck the narrow layout", updatedAt: today.toISOString() },
  { id: "ideas", title: "Ideas for the weekend", body: "A walk, a book, and a new recipe.", updatedAt: today.toISOString() },
]), "application/json");
seed("Documents/.dindbos/reminders.json", JSON.stringify([
  { id: "review", title: "Review the design", due: day, done: false },
  { id: "read", title: "Read the documentation", due: "", done: false },
]), "application/json");
seed("Documents/.dindbos/calendar.json", JSON.stringify([
  { id: "meeting", title: "Design review", date: day, time: "14:00" },
]), "application/json");
seed("Pictures/Alpine study.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#acd5df"/><path d="M0 400L200 100 440 400M200 400L460 160 640 400" fill="#346851"/><path d="M150 175L200 100 260 175M405 220L460 160 520 220" fill="#f8fbff"/><rect y="400" width="640" height="80" fill="#5d9871"/></svg>', "image/svg+xml");
const audio = new Uint8Array(44 + 8000);
const wav = new DataView(audio.buffer);
const writeASCII = (offset, value) => [...value].forEach((character, index) => { audio[offset + index] = character.charCodeAt(0); });
writeASCII(0, "RIFF"); wav.setUint32(4, audio.length - 8, true); writeASCII(8, "WAVEfmt "); wav.setUint32(16, 16, true);
wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, 8000, true); wav.setUint32(28, 8000, true);
wav.setUint16(32, 1, true); wav.setUint16(34, 8, true); writeASCII(36, "data"); wav.setUint32(40, 8000, true); audio.fill(128, 44);
seed("Music/Quiet moment.wav", audio, "audio/wav");

const contexts = {
  files: { path: `${home}/Documents` },
  text: { node: os.fs.resolve(`${home}/Documents/Project plan.txt`) },
  browser: { node: os.fs.resolve(`${home}/Documents/Start.html`) },
  viewer: { node: os.fs.resolve(`${home}/Documents/Welcome.md`) },
};
window.platformAppsQA = {
  os,
  appIds: os.apps.list().map((app) => app.id),
  show(id) {
    for (const task of os.windows.windows.values()) if (!task.minimized) os.windows.minimize(task.id);
    const task = [...os.windows.windows.values()].find((task) => task.appId === id);
    if (task) { os.windows.restore(task.id); return task.id; }
    os.launch(id, contexts[id] || {});
    return os.windows.activeWindowId;
  },
};
root.dataset.qaReady = "true";
