#!/usr/bin/env node
import { AppRegistry } from "../src/dindbos/app-registry.js";
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
import { buildViewerDiagnostics, cleanupViewerObjectUrl, installBuiltinApps, readViewerPreviewBytes, renderMarkdownPreview, viewerEditTargetApp, viewerMarkup, viewerPdfAdapterStatus, viewerPreviewCacheKey, viewerPreviewForBytes, viewerZoomValue, wirePdfJsViewer } from "../src/dindbos/apps/builtins.js";
import { RuntimeCacheStore } from "../src/dindbos/cache-store.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const markdown = [
  "# Title",
  "",
  "- first",
  "- <script>alert(1)</script>",
  "",
  "```",
  "<b>code</b>",
  "```",
].join("\n");

const markdownHtml = renderMarkdownPreview(markdown);
assert(markdownHtml.includes("<h3>Title</h3>"), "markdown heading did not render");
assert(markdownHtml.includes("<ul>"), "markdown list did not render");
assert(markdownHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "markdown did not escape raw script tag");
assert(!markdownHtml.includes("<script>"), "markdown emitted executable script tag");
assert(markdownHtml.includes("&lt;b&gt;code&lt;/b&gt;"), "markdown code fence did not escape HTML");

const viewerHtml = viewerMarkup({
  mime: "text/markdown",
  name: "README.md",
  path: "/home/guest/README.md",
  preview: markdown,
  url: "",
});
assert(viewerHtml.includes("viewer-markdown"), "viewer markup did not use markdown preview");
assert(!viewerHtml.includes("<script>"), "viewer markdown markup emitted script tag");
assert(viewerHtml.includes("viewer-toolbar"), "viewer toolbar was not rendered");
assert(viewerHtml.includes('data-viewer-action="zoom-in"'), "viewer zoom-in action missing");
assert(viewerHtml.includes('data-viewer-action="copy-path"'), "viewer copy path action missing");
assert(viewerHtml.includes('data-viewer-action="open-editor"'), "viewer edit action missing");
assert(!viewerHtml.includes('data-viewer-action="open-editor" disabled'), "viewer edit action was disabled for markdown");
assert(viewerEditTargetApp("text/markdown", "/home/guest/README.md") === "text", "markdown edit target mismatch");
assert(viewerEditTargetApp("application/json", "/home/guest/data.json") === "text", "json edit target mismatch");
assert(viewerEditTargetApp("application/pdf", "/home/guest/paper.pdf") === "", "PDF edit target should be empty");
assert(viewerEditTargetApp("text/markdown", "") === "", "pathless markdown edit target should be empty");
const diagnosticHtml = viewerMarkup({
  mime: "text/markdown",
  name: "README.md",
  path: "/home/guest/README.md",
  preview: markdown,
  url: "",
  diagnostics: buildViewerDiagnostics({
    node: { path: "/home/guest/README.md", size: 12 },
    mime: "text/markdown",
    bytes: new TextEncoder().encode(markdown),
    previewState: { status: "Text preview · 12 B" },
    cacheStatus: { hits: 1, writes: 1 },
  }),
});
assert(diagnosticHtml.includes("data-viewer-diagnostics"), "viewer diagnostics markup missing");
assert(diagnosticHtml.includes("Preview bytes are cacheable"), "viewer diagnostics advice missing");
const pdfHtml = viewerMarkup({
  mime: "application/pdf",
  name: "paper.pdf",
  path: "/home/guest/paper.pdf",
  preview: "",
  url: "blob:paper",
});
assert(pdfHtml.includes("data-viewer-pdf-canvas"), "viewer PDF markup did not include PDF.js canvas");
assert(pdfHtml.includes('data-viewer-action="page-prev"'), "viewer PDF previous page action missing");
assert(pdfHtml.includes('data-viewer-action="page-next"'), "viewer PDF next page action missing");
assert(pdfHtml.includes('data-viewer-action="open-editor" disabled'), "viewer PDF edit action was not disabled");
assert(!pdfHtml.includes("data-viewer-diagnostics"), "viewer diagnostics rendered when not requested");
assert(viewerPdfAdapterStatus(null).includes("deployment-provided, not bundled"), "PDF.js missing status did not document deployment-provided policy");
assert(viewerPdfAdapterStatus(fakePdfJsLib()).includes("PDF.js adapter available"), "PDF.js available status missing");
assert(viewerPdfAdapterStatus(null, { failed: true }).includes("adapter failed"), "PDF.js failure status missing");
const pdfDiagnostics = buildViewerDiagnostics({
  node: { path: "/home/guest/paper.pdf", size: 4 },
  mime: "application/pdf",
  bytes: new Uint8Array([37, 80, 68, 70]),
  status: viewerPdfAdapterStatus(null),
});
assert(pdfDiagnostics.pdfAdapter === "native", "viewer diagnostics did not classify native PDF fallback");
assert(pdfDiagnostics.advice.includes("PDF.js adapter is not bundled"), `PDF diagnostics advice mismatch: ${pdfDiagnostics.advice}`);
assert(viewerZoomValue(1, "zoom-in") === 1.1, "viewer zoom-in value mismatch");
assert(viewerZoomValue(0.5, "zoom-out") === 0.5, "viewer zoom lower clamp mismatch");
assert(viewerZoomValue(2.8, "zoom-in") === 2.9, "viewer zoom high value mismatch");
assert(viewerZoomValue(2.2, "zoom-reset") === 1, "viewer zoom reset mismatch");

const largeText = new Uint8Array(300 * 1024).fill("a".charCodeAt(0));
const largePreview = viewerPreviewForBytes(largeText, "text/plain");
assert(largePreview.status.includes("Large text preview"), "large text preview status missing");
assert(largePreview.preview.includes("Preview truncated"), "large text preview did not include truncation notice");
assert(largePreview.preview.length < largeText.byteLength, "large text preview was not bounded");
const largeDiagnostics = buildViewerDiagnostics({
  node: { path: "/home/guest/large.txt", size: largeText.byteLength },
  mime: "text/plain",
  bytes: largeText,
  previewState: largePreview,
  cacheStatus: { hits: 2, writes: 3 },
});
assert(largeDiagnostics.truncated === true, "viewer diagnostics did not flag large text truncation");
assert(largeDiagnostics.cacheable === true, "viewer diagnostics did not mark text cacheable");
assert(largeDiagnostics.advice.includes("Large text is bounded"), `large diagnostics advice mismatch: ${largeDiagnostics.advice}`);
const binaryPreview = viewerPreviewForBytes(new Uint8Array([1, 2, 3, 4]), "application/octet-stream");
assert(binaryPreview.preview.includes("Binary file"), "binary preview text missing");
assert(binaryPreview.status.includes("Binary preview"), "binary preview status missing");
const binaryDiagnostics = buildViewerDiagnostics({
  node: { path: "/home/guest/payload.bin", size: 4 },
  mime: "application/octet-stream",
  bytes: new Uint8Array([1, 2, 3, 4]),
  previewState: binaryPreview,
});
assert(binaryDiagnostics.binary === true, "viewer diagnostics did not flag binary fallback");
assert(binaryDiagnostics.cacheable === false, "viewer diagnostics unexpectedly cached binary fallback");
assert(binaryDiagnostics.advice.includes("No text renderer"), `binary diagnostics advice mismatch: ${binaryDiagnostics.advice}`);
const deckPreview = viewerPreviewForBytes(new TextEncoder().encode("<section>Slide</section><script>alert(1)</script>"), "application/x-dindbos-deck");
assert(deckPreview.preview.includes("<section>Slide</section>"), "deck preview did not decode HTML source");
assert(deckPreview.status.includes("Text preview"), "deck preview was not treated as bounded text");
const deckHtml = viewerMarkup({
  mime: "application/x-dindbos-deck",
  name: "portfolio.deck.html",
  path: "/home/guest/portfolio.deck.html",
  preview: deckPreview.preview,
  url: "",
});
assert(deckHtml.includes("viewer-deck"), "viewer markup did not render deck iframe");
assert(deckHtml.includes("sandbox=\"\""), "deck iframe is not sandboxed");
assert(deckHtml.includes("srcdoc="), "deck iframe did not use srcdoc");
assert(!deckHtml.includes("<script>"), "deck markup emitted raw executable script tag");

const pdfContent = fakePdfContent();
const pdfState = await wirePdfJsViewer(pdfContent, new Uint8Array([37, 80, 68, 70]), "paper.pdf", fakePdfJsLib());
assert(pdfState.page === 1 && pdfState.pageCount === 2, "PDF.js viewer did not initialize page state");
assert(pdfContent.canvas.hidden === false, "PDF.js viewer did not reveal canvas");
assert(pdfContent.nativeFrame.hidden === true, "PDF.js viewer did not hide native PDF iframe");
assert(pdfContent.status.textContent === "Page 1 of 2 · PDF.js", "PDF.js viewer status mismatch");
assert(pdfContent.next.disabled === false, "PDF.js viewer kept next disabled on page one");
await pdfContent.next.click();
assert(pdfState.page === 2, "PDF.js viewer next page did not update state");
assert(pdfContent.previous.disabled === false && pdfContent.next.disabled === true, "PDF.js viewer page button state mismatch");

const revoked = [];
const originalRevoke = globalThis.URL?.revokeObjectURL;
globalThis.URL.revokeObjectURL = (url) => revoked.push(url);
const content = { dataset: { viewerObjectUrl: "blob:viewer-smoke" } };
cleanupViewerObjectUrl(content);
if (originalRevoke) globalThis.URL.revokeObjectURL = originalRevoke;
assert(revoked[0] === "blob:viewer-smoke", "viewer object URL was not revoked");
assert(!content.dataset.viewerObjectUrl, "viewer object URL dataset was not cleared");

const os = bootOs();
installBuiltinApps(os, { portfolioData: { name: "Smoke", summary: "", projects: [] } });
assert(!os.apps.getManifest("text").fileSystem.read.includes("/"), "TextEdit kept root read scope");
assert(!os.apps.getManifest("viewer").fileSystem.read.includes("/"), "Viewer.app kept root read scope");
assert(!os.apps.getManifest("browser").fileSystem.read.includes("/"), "Browser.app kept root read scope");
assert(os.apps.getManifest("viewer").capabilities.includes("app.launch"), "Viewer.app cannot hand off documents to apps");
assert(resolve(os, "document.pdf", "application/pdf") === "viewer", "PDF did not resolve to Viewer.app");
assert(resolve(os, "image.png", "image/png") === "viewer", "image did not resolve to Viewer.app");
assert(resolve(os, "README.md", "text/markdown") === "viewer", "markdown did not resolve to Viewer.app");
assert(resolve(os, "portfolio.deck.html", "application/x-dindbos-deck") === "viewer", "deck did not resolve to Viewer.app");
assert(resolve(os, "page.html", "text/html") === "browser", "HTML did not resolve to Browser.app");
assert(resolve(os, "note.txt", "text/plain") === "text", "plain text did not resolve to TextEdit");
assert(resolve(os, "payload.bin", "application/octet-stream") === "", "unknown binary unexpectedly resolved");
os.fs.createFile("/home/guest/portfolio.deck.html", "/", { content: "<section>Deck</section>" });
assert(os.fs.stat("/home/guest/portfolio.deck.html").mime === "application/x-dindbos-deck", "VFS deck MIME detection failed");
os.fs.writeOrCreateFileBytes("/home/guest/image.png", new Uint8Array([137, 80, 78, 71]), "/", { mime: "image/png" });
const imageNode = os.fs.stat("/home/guest/image.png");
const imageKey = viewerPreviewCacheKey(imageNode, imageNode.mime);
assert(imageKey.includes("viewer-preview"), "viewer preview cache key did not use viewer namespace");
const imageBytes = await readViewerPreviewBytes(os, imageNode, imageNode.mime);
assert(imageBytes.byteLength === 4, "viewer preview cache read wrong image bytes");
assert(os.cache.status().writes === 1, "viewer preview cache did not write first image read");
const imageHitsBefore = os.cache.status().hits;
const imageBytesAgain = await readViewerPreviewBytes(os, imageNode, imageNode.mime);
assert(imageBytesAgain.byteLength === 4, "viewer preview cache hit returned wrong image bytes");
assert(os.cache.status().hits === imageHitsBefore + 1, "viewer preview cache did not report image cache hit");
os.fs.writeOrCreateFile("/home/guest/cached.md", "# cached\n", "/", { mime: "text/markdown" });
const markdownNode = os.fs.stat("/home/guest/cached.md");
await readViewerPreviewBytes(os, markdownNode, markdownNode.mime);
assert(os.cache.status().writes === 2, "viewer preview cache did not cache markdown document bytes");
os.fs.createDirectory("/root", "/", { owner: "root", group: "root", permissions: "drwx------" }, os.permissions.systemPrincipal());
os.fs.writeOrCreateFile("/root/secret.md", "# secret\n", "/", { mime: "text/markdown", owner: "root", group: "root", permissions: "-rw-------" }, os.permissions.systemPrincipal());
os.fs.writeOrCreateFile("/root/secret.txt", "secret\n", "/", { mime: "text/plain", owner: "root", group: "root", permissions: "-rw-------" }, os.permissions.systemPrincipal());
const deniedViewer = os.apps.openFile(os.fs.stat("/root/secret.md", "/", os.permissions.systemPrincipal()));
await waitFor(() => deniedViewer.content.innerHTML.includes("sandbox denied"), "Viewer.app did not enforce narrowed read scope for root-owned file");
const deniedText = os.apps.openFile(os.fs.stat("/root/secret.txt", "/", os.permissions.systemPrincipal()));
await waitFor(() => deniedText.content.innerHTML.includes("sandbox denied"), "TextEdit did not enforce narrowed read scope for root-owned file");

console.log("viewer smoke ok markdown associations");

function bootOs() {
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
  const system = permissions.systemPrincipal();
  fs.createDirectory("/usr", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/usr/share", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/usr/share/applications", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/home", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/home/guest", "/", { owner: "guest", group: "users" }, system);
  const os = {
    fs,
    permissions,
    cache: new RuntimeCacheStore({ cacheApi: null }),
    session: { user: "guest", groups: ["users"], home: "/home/guest" },
    localMounts: { isMountedPath: () => false },
    processes: fakeProcesses(),
    windows: fakeWindows(),
  };
  os.apps = new AppRegistry(os);
  os.registerApp = (app) => os.apps.register(app);
  os.createSandbox = (process) => new AppSandbox(os, process);
  return os;
}

function resolve(os, name, mime) {
  return os.apps.resolveFileApp({ name, mime })?.id || "";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fakePdfJsLib() {
  return {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (pageNumber) => ({
          getViewport: ({ scale }) => ({ width: 200 * scale, height: 280 * scale }),
          render: ({ canvasContext, viewport }) => {
            canvasContext.rendered = { pageNumber, viewport };
            return { promise: Promise.resolve() };
          },
        }),
      }),
    }),
  };
}

function fakePdfContent() {
  const status = { textContent: "" };
  const canvas = {
    hidden: true,
    width: 0,
    height: 0,
    context: {},
    getContext() {
      return this.context;
    },
  };
  const nativeFrame = { hidden: false };
  const previous = fakeButton();
  const next = fakeButton();
  return {
    status,
    canvas,
    nativeFrame,
    previous,
    next,
    querySelector(selector) {
      if (selector === "[data-viewer-pdf-canvas]") return canvas;
      if (selector === "[data-viewer-object]") return nativeFrame;
      if (selector === "[data-viewer-status]") return status;
      if (selector === "[data-viewer-action='page-prev']") return previous;
      if (selector === "[data-viewer-action='page-next']") return next;
      return null;
    },
  };
}

function fakeButton() {
  const listeners = [];
  return {
    disabled: false,
    addEventListener(_type, listener) {
      listeners.push(listener);
    },
    async click() {
      await Promise.all(listeners.map((listener) => listener()));
    },
  };
}

function fakeProcesses() {
  let nextPid = 200;
  return {
    spawn: (app, context) => ({
      pid: nextPid++,
      appId: app.id,
      context,
      cwd: "/home/guest",
      logs: [],
      manifest: app.manifest || {},
      name: app.name || app.id,
      state: "running",
      user: "guest",
    }),
    attachWindow: () => {},
    kill: () => {},
    crash: () => {},
    log: () => {},
  };
}

function fakeWindows() {
  return {
    has: () => false,
    activate: () => null,
    open: (options) => {
      const content = { innerHTML: "", dataset: {}, querySelector: () => null, querySelectorAll: () => [] };
      const windowApi = { setTitle: (title) => { options.title = title; } };
      const record = { ...options, content };
      options.render(content, windowApi);
      return record;
    },
  };
}

async function waitFor(check, label) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(label);
}
