#!/usr/bin/env node
import {
  BROWSER_LOCAL_HTML_SANDBOX,
  activeBrowserTab,
  browserSessionSnapshot,
  browserChromeShortcut,
  browserDiagnosticsMarkup,
  browserKeyEventPayload,
  browserTabNavigate,
  browserViewportMetrics,
  buildBrowserDiagnostics,
  closeBrowserTab,
  createBrowserSessionState,
  createBrowserNewTab,
  normalizeBrowserAddress,
  reopenBrowserTab,
} from "../src/dindbos/apps/builtins.js";

assert(normalizeBrowserAddress("") === "about:blank", "empty address did not become about:blank");
assert(normalizeBrowserAddress("example.com") === "https://example.com", "domain did not become https URL");
assert(normalizeBrowserAddress("https://example.com/x") === "https://example.com/x", "https URL changed");
assert(normalizeBrowserAddress("http://example.com/x") === "http://example.com/x", "http URL changed");
assert(normalizeBrowserAddress("localhost:5174") === "http://localhost:5174", "localhost port did not become http URL");
assert(normalizeBrowserAddress("127.0.0.1:5174") === "http://127.0.0.1:5174", "127.0.0.1 did not become http URL");
assert(normalizeBrowserAddress("about:blank") === "about:blank", "about:blank was not preserved");
assert(normalizeBrowserAddress("data:text/html,ok") === "data:text/html,ok", "HTML data URL was not preserved");
assert(normalizeBrowserAddress("search words") === "https://www.google.com/search?q=search%20words", "search query URL mismatch");

assertRejects(() => normalizeBrowserAddress("javascript:alert(1)"), "javascript:");
assertRejects(() => normalizeBrowserAddress("file:///etc/passwd"), "file:");
assertRejects(() => normalizeBrowserAddress("chrome://version"), "chrome:");

assert(BROWSER_LOCAL_HTML_SANDBOX.includes("allow-scripts"), "local HTML sandbox should allow document scripts");
assert(BROWSER_LOCAL_HTML_SANDBOX.includes("allow-forms"), "local HTML sandbox should allow forms");
assert(!BROWSER_LOCAL_HTML_SANDBOX.includes("allow-same-origin"), "local HTML sandbox must not allow same-origin access");
assert(!BROWSER_LOCAL_HTML_SANDBOX.includes("allow-top-navigation"), "local HTML sandbox must not allow top navigation");

const initialSession = createBrowserSessionState({ url: "example.com" });
assert(initialSession.address === "example.com", "browser session did not use context URL");
const remoteProviderSession = createBrowserSessionState({ browserProviderUrl: "wss://browser.example.test/session" });
assert(remoteProviderSession.companionUrl === "wss://browser.example.test/session", "browser session did not accept remote provider URL");
const remoteProviderSnapshot = browserSessionSnapshot(remoteProviderSession);
assert(remoteProviderSnapshot.companionUrl === "wss://browser.example.test/session", "browser session snapshot did not preserve remote provider URL");
const remoteDiagnostics = buildBrowserDiagnostics(remoteProviderSession, { connected: false });
assert(remoteDiagnostics.provider === "remote provider", "browser diagnostics did not detect remote provider");
assert(remoteDiagnostics.healthUrl === "https://browser.example.test/health", "browser diagnostics health URL mismatch");
assert(remoteDiagnostics.stream === "cdp-screencast/binary-jpeg", "browser diagnostics stream policy mismatch");
assert(remoteDiagnostics.advice.includes("WSS endpoint"), "browser diagnostics remote advice missing");
const mismatchDiagnostics = buildBrowserDiagnostics({ status: "browserd stream mismatch" }, { connected: false });
assert(mismatchDiagnostics.advice.includes("protocol contract"), "browser diagnostics mismatch advice missing");
const restoredSession = createBrowserSessionState({ url: "new.example" }, {
  mode: "companion",
  status: "ready https://example.com",
  address: "https://example.com",
  title: "Example Domain",
  frame: "data:image/jpeg;base64,abc",
  localHtml: "<main>cached</main>",
  companionUrl: "wss://browser.example.test/browser",
});
assert(restoredSession.address === "https://example.com", "browser session did not preserve restored address");
assert(restoredSession.title === "Example Domain", "browser session did not preserve restored title");
assert(restoredSession.status === "ready https://example.com", "browser session did not preserve restored status");
assert(restoredSession.mode === "companion", "browser session did not preserve restored mode");
assert(restoredSession.companionUrl === "wss://browser.example.test/browser", "browser session did not preserve restored provider URL");
const invalidSession = createBrowserSessionState({}, { mode: "invalid", address: "/home/guest/page.html" });
assert(invalidSession.mode === "idle", "browser session accepted invalid restored mode");
assert(invalidSession.address === "/home/guest/page.html", "browser session dropped restored local address");
const snapshot = browserSessionSnapshot({ mode: "local", status: "local document /x.html", address: "/x.html", title: "x.html", localHtml: "<h1>x</h1>" });
assert(snapshot.mode === "local" && snapshot.localHtml.includes("<h1>x</h1>"), "browser session snapshot lost local state");
assert(snapshot.tabs.length === 1 && snapshot.activeTabId === "tab-1", "browser session snapshot did not include default tab");
const localDiagnostics = buildBrowserDiagnostics(snapshot, { connected: false });
const localDiagnosticMarkup = browserDiagnosticsMarkup(localDiagnostics);
assert(localDiagnostics.mode === "local", "browser diagnostics did not preserve local mode");
assert(localDiagnostics.advice.includes("Local HTML is sandboxed"), "browser local diagnostics advice missing");
assert(localDiagnosticMarkup.includes("data-browser-diagnostics-panel"), "browser diagnostics markup missing");
assert(localDiagnosticMarkup.includes("cdp-screencast/binary-jpeg"), "browser diagnostics stream markup missing");

const tabbedSession = createBrowserSessionState({}, {
  tabs: [
    { id: "tab-1", mode: "companion", address: "https://one.example", title: "One", status: "ready one", history: ["https://one.example"], historyIndex: 0 },
    { id: "tab-2", mode: "local", address: "/home/guest/page.html", title: "page.html", localHtml: "<h1>page</h1>", history: ["/home/guest/page.html"], historyIndex: 0 },
  ],
  activeTabId: "tab-2",
});
assert(tabbedSession.address === "/home/guest/page.html" && tabbedSession.mode === "local", "browser session did not restore active tab state");
browserTabNavigate(tabbedSession, "/home/guest/next.html", { mode: "local", title: "next.html" });
assert(activeBrowserTab(tabbedSession).history.join("|") === "/home/guest/page.html|/home/guest/next.html", "browser tab did not record per-tab history");
createBrowserNewTab(tabbedSession, { address: "example.com", title: "Example" });
assert(tabbedSession.tabs.length === 3 && tabbedSession.address === "example.com", "browser new tab did not become active");
closeBrowserTab(tabbedSession);
assert(tabbedSession.tabs.length === 2 && tabbedSession.closedTabs.length === 1, "browser close tab did not retain closed tab");
reopenBrowserTab(tabbedSession);
assert(tabbedSession.tabs.length === 3 && tabbedSession.address === "example.com", "browser reopen tab did not restore closed tab");
const connectedDiagnostics = buildBrowserDiagnostics(tabbedSession, { connected: true });
assert(connectedDiagnostics.connected === true, "browser diagnostics did not mark connected provider");
assert(connectedDiagnostics.tabs === 3, "browser diagnostics tab count mismatch");
assert(connectedDiagnostics.advice.includes("explicit Browser.app provider boundary"), "browser connected diagnostics advice missing");

assert(browserChromeShortcut({ key: "l", ctrlKey: true }) === "focus-address", "ctrl-l did not focus browser address");
assert(browserChromeShortcut({ key: "L", metaKey: true }) === "focus-address", "cmd-l did not focus browser address");
assert(browserChromeShortcut({ key: "l" }) === "", "plain l should not focus browser address");
const tab = browserKeyEventPayload({ key: "Tab", code: "Tab", shiftKey: true });
assert(tab.key === "Tab" && tab.modifiers === 8 && tab.text === undefined, "shift-tab payload mismatch");
const selectAll = browserKeyEventPayload({ key: "a", code: "KeyA", ctrlKey: true });
assert(selectAll.key === "a" && selectAll.modifiers === 2 && selectAll.text === undefined, "ctrl-a selection shortcut payload mismatch");
const copy = browserKeyEventPayload({ key: "c", code: "KeyC", metaKey: true });
assert(copy.key === "c" && copy.modifiers === 4 && copy.text === undefined, "cmd-c shortcut payload mismatch");
const printable = browserKeyEventPayload({ key: "x", code: "KeyX" });
assert(printable.key === "x" && printable.text === "x", "printable text payload mismatch");
const desktopMetrics = browserViewportMetrics({ width: 940, height: 640 }, 1, { maxTouchPoints: 0 });
assert(desktopMetrics.mobile === false && desktopMetrics.width === 940, "desktop browser viewport metrics mismatch");
const narrowMetrics = browserViewportMetrics({ width: 390, height: 640 }, 2, { maxTouchPoints: 0 });
assert(narrowMetrics.mobile === true && narrowMetrics.scale === 2, "narrow browser viewport was not treated as mobile");
const touchMetrics = browserViewportMetrics({ width: 920, height: 640 }, 1, { maxTouchPoints: 1 });
assert(touchMetrics.mobile === true, "touch browser viewport was not treated as mobile");

console.log("browser address smoke ok");

function assertRejects(action, expectedMessage) {
  try {
    action();
  } catch (error) {
    if (error.message.includes(expectedMessage)) return;
    throw new Error(`unexpected rejection: ${error.message}`);
  }
  throw new Error(`expected rejection containing ${expectedMessage}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
