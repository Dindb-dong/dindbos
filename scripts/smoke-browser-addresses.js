#!/usr/bin/env node
import {
  BROWSER_LOCAL_HTML_SANDBOX,
  activeBrowserTab,
  browserSessionSnapshot,
  browserChromeShortcut,
  browserKeyEventPayload,
  browserTabNavigate,
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
const restoredSession = createBrowserSessionState({ url: "new.example" }, {
  mode: "companion",
  status: "ready https://example.com",
  address: "https://example.com",
  title: "Example Domain",
  frame: "data:image/jpeg;base64,abc",
  localHtml: "<main>cached</main>",
});
assert(restoredSession.address === "https://example.com", "browser session did not preserve restored address");
assert(restoredSession.title === "Example Domain", "browser session did not preserve restored title");
assert(restoredSession.status === "ready https://example.com", "browser session did not preserve restored status");
assert(restoredSession.mode === "companion", "browser session did not preserve restored mode");
const invalidSession = createBrowserSessionState({}, { mode: "invalid", address: "/home/guest/page.html" });
assert(invalidSession.mode === "idle", "browser session accepted invalid restored mode");
assert(invalidSession.address === "/home/guest/page.html", "browser session dropped restored local address");
const snapshot = browserSessionSnapshot({ mode: "local", status: "local document /x.html", address: "/x.html", title: "x.html", localHtml: "<h1>x</h1>" });
assert(snapshot.mode === "local" && snapshot.localHtml.includes("<h1>x</h1>"), "browser session snapshot lost local state");
assert(snapshot.tabs.length === 1 && snapshot.activeTabId === "tab-1", "browser session snapshot did not include default tab");

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
