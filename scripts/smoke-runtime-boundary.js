#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { normalizeAppManifest } from "../src/dindbos/app-manifest.js";

const main = readFileSync("src/main.js", "utf8");
assert(!/\b(?:window|globalThis)\.dindbos\b/.test(main), "entrypoint exposes raw DindbOS runtime globally");

const minimal = normalizeAppManifest({ id: "third-party", name: "Third Party" });
assert(minimal.fileSystem.read.length === 0, "minimal app manifest should not receive implicit root read access");
assert(minimal.fileSystem.write.length === 0, "minimal app manifest should not receive implicit write access");

const scoped = normalizeAppManifest({
  id: "scoped",
  name: "Scoped",
  manifest: {
    fileSystem: {
      read: ["/opt/scoped"],
      write: ["/home/guest/Documents/scoped"],
    },
  },
});
assert(scoped.fileSystem.read[0] === "/opt/scoped", "explicit app read scope was not preserved");
assert(scoped.fileSystem.write[0] === "/home/guest/Documents/scoped", "explicit app write scope was not preserved");

const packageManager = readFileSync("src/dindbos/package-manager.js", "utf8");
assert(packageManager.includes("package import URL not declared"), "package import facade should deny undeclared import URLs");

console.log("runtime boundary smoke ok no-global deny-default declared-imports");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
