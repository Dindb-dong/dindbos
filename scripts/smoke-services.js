#!/usr/bin/env node
import { createDindbOSTestRuntime } from "./helpers/dindbos-test-runtime.js";

const os = createDindbOSTestRuntime();
const events = [];
["start", "stop", "crash", "scheduled-run", "degraded", "suspend", "resume"].forEach((type) => {
  os.bus.on(`service:${type}`, (event) => events.push(`${type}:${event.service.id}:${event.service.state}`));
});

os.services.register({
  id: "search-indexer",
  name: "Search Indexer",
  schedule: { everyMs: 60000 },
  fileSystem: { read: ["/home/guest"], write: ["/var/lib/dindbos/search"] },
  start: ({ log }) => log("indexer boot"),
  run: ({ os: runtime, log }) => {
    if (!runtime.fs.exists("/var/lib")) runtime.fs.createDirectory("/var/lib", "/", {}, runtime.permissions.systemPrincipal());
    if (!runtime.fs.exists("/var/lib/dindbos")) runtime.fs.createDirectory("/var/lib/dindbos", "/", {}, runtime.permissions.systemPrincipal());
    if (!runtime.fs.exists("/var/lib/dindbos/search")) runtime.fs.createDirectory("/var/lib/dindbos/search", "/", {}, runtime.permissions.systemPrincipal());
    runtime.fs.writeOrCreateFile("/var/lib/dindbos/search/last-run.txt", "indexed\n", "/", {}, runtime.permissions.systemPrincipal());
    log("indexer run");
  },
});

const started = await os.services.start("search-indexer");
assert(started.state === "running", "service did not enter running state");
assert(started.pid > 0 && os.processes.get(started.pid), "service did not create a runtime process");
assert(os.fs.readFile("/var/run/dindbos/services.json").includes("search-indexer"), "service state file missing registered service");
assert(os.fs.readFile("/var/log/dindbos/services.log").includes("indexer boot"), "service log missing start entry");
assert(events.includes("start:search-indexer:running"), "service start event missing");

const scheduled = await os.services.runScheduled("search-indexer");
assert(scheduled.runCount === 1, "scheduled service run count mismatch");
assert(os.fs.readFile("/var/lib/dindbos/search/last-run.txt") === "indexed\n", "scheduled service did not write runtime state");
assert(events.includes("scheduled-run:search-indexer:running"), "scheduled-run event missing");

os.services.suspend("visibility-hidden");
assert(os.services.get("search-indexer").state === "suspended", "service did not suspend");
os.services.resume("visibility-visible");
assert(os.services.get("search-indexer").state === "running", "service did not resume");
assert(events.includes("suspend:search-indexer:suspended"), "service suspend event missing");
assert(events.includes("resume:search-indexer:running"), "service resume event missing");

const deniedPrincipal = os.permissions.principal({ user: "guest", groups: ["users"] });
assertThrows(() => os.services.stop("search-indexer", { principal: deniedPrincipal }), "service: manage denied");

os.services.register({
  id: "failing-sync",
  name: "Failing Sync",
  run: () => {
    throw new Error("sync failed");
  },
});
await os.services.start("failing-sync");
const degraded = await os.services.runScheduled("failing-sync");
assert(degraded.state === "degraded", "failed scheduled service did not degrade");
assert(degraded.lastError === "sync failed", "degraded service missing last error");

const crashed = os.services.crash("failing-sync", new Error("boom service"));
assert(crashed.state === "crashed", "service crash state mismatch");
assert(os.fs.exists(`/var/log/dindbos/crash-${crashed.pid}.log`), "service crash did not write process crash report");
assert(events.includes("crash:failing-sync:crashed"), "service crash event missing");

const restarted = await os.services.restart("failing-sync");
assert(restarted.state === "running", "service restart did not return to running");
assert(restarted.pid !== crashed.pid, "service restart reused crashed pid");
os.services.disable("failing-sync");
assert(os.services.get("failing-sync").state === "disabled", "service disable state mismatch");

console.log("services smoke ok lifecycle schedule suspend permission crash restart");

function assertThrows(fn, expected) {
  try {
    fn();
  } catch (error) {
    if (!String(error.message).includes(expected)) throw error;
    return;
  }
  throw new Error(`expected error containing ${expected}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
