#!/usr/bin/env node
import { BROWSER_LOCAL_HTML_SANDBOX, normalizeBrowserAddress } from "../src/dindbos/apps/builtins.js";

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
