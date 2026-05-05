#!/usr/bin/env node
import { settingsRuntimeMarkup, settingsRuntimeSnapshot } from "../src/dindbos/apps/builtins.js";

const calls = {
  apps: 0,
  estimate: 0,
  mounts: 0,
  packages: 0,
  processes: 0,
  recovery: 0,
  services: 0,
  status: 0,
  lifecycle: 0,
  coordination: 0,
};

const os = {
  session: { user: "guest", home: "/home/guest" },
  apps: {
    list() {
      calls.apps += 1;
      return [{ id: "files" }, { id: "settings" }];
    },
  },
  packages: {
    list() {
      calls.packages += 1;
      return [{ id: "pkg.notes" }];
    },
  },
  processes: {
    list() {
      calls.processes += 1;
      return [{ pid: 1 }, { pid: 2 }, { pid: 3 }];
    },
  },
  services: {
    list() {
      calls.services += 1;
      return [
        {
          id: "search-indexer",
          name: "Search Indexer",
          state: "running",
          runCount: 3,
        },
      ];
    },
  },
  storage: {
    status() {
      calls.status += 1;
      return {
        backend: "opfs",
        bytes: 4096,
        enabled: true,
        persistPending: true,
        storageFormat: "json-v1",
      };
    },
    async estimate() {
      calls.estimate += 1;
      return {
        backend: "opfs",
        persistFlushes: 2,
        quota: 1024 * 1024,
        usage: 64 * 1024,
        writePending: true,
      };
    },
  },
  localMounts: {
    async status() {
      calls.mounts += 1;
      return [
        {
          access: "readwrite",
          handleName: "Project",
          path: "/mnt/project",
          status: "ready",
        },
      ];
    },
  },
  lifecycleStatus() {
    calls.lifecycle += 1;
    return {
      state: "recovered",
      reason: "dirty-shutdown",
      updatedAt: "2026-05-05T00:00:00.000Z",
    };
  },
  recoveryStatus() {
    calls.recovery += 1;
    return {
      lastRecovery: { recoveredAt: "2026-05-05T00:00:00.000Z" },
      lastShutdown: { recordedAt: "2026-05-04T23:59:59.000Z" },
      closedPagePersistence: false,
      unsupportedAfterClose: ["worker execution"],
      supportedWhileHidden: ["best-effort filesystem flush"],
    };
  },
  sessionCoordinationStatus() {
    calls.coordination += 1;
    return {
      instanceId: "settings-tab",
      role: "secondary",
      lockOwner: "primary-tab",
      readonly: true,
      staleRecovered: false,
      channel: { connected: true, received: 2 },
      conflicts: { pending: 1, total: 3 },
      storageFlush: { lastPeerSource: "primary-tab", lastPeerPhase: "complete" },
      appState: { lastPeerAppId: "api-lab", lastPeerAction: "set" },
    };
  },
  fs: {
    join(base, name) {
      return `${base}/${name}`;
    },
  },
};

const snapshot = await settingsRuntimeSnapshot(os);

assert(calls.apps === 1, "settings snapshot did not read app registry state");
assert(calls.packages === 1, "settings snapshot did not read package state");
assert(calls.processes === 1, "settings snapshot did not read process state");
assert(calls.services === 1, "settings snapshot did not read service state");
assert(calls.status === 1, "settings snapshot did not read storage status");
assert(calls.estimate === 1, "settings snapshot did not read storage estimate");
assert(calls.mounts === 1, "settings snapshot did not read local mount status");
assert(calls.lifecycle === 1, "settings snapshot did not read lifecycle status");
assert(calls.recovery === 1, "settings snapshot did not read recovery status");
assert(calls.coordination === 1, "settings snapshot did not read session coordination status");

assert(snapshot.user === "guest", "settings snapshot user mismatch");
assert(snapshot.home === "/home/guest", "settings snapshot home mismatch");
assert(snapshot.apps.length === 2, "settings snapshot app count mismatch");
assert(snapshot.packages.length === 1, "settings snapshot package count mismatch");
assert(snapshot.processes.length === 3, "settings snapshot process count mismatch");
assert(snapshot.services.length === 1, "settings snapshot service count mismatch");
assert(snapshot.storage.backend === "opfs", "settings snapshot storage backend mismatch");
assert(snapshot.storage.writePending === true, "settings snapshot storage pending state mismatch");
assert(snapshot.mounts[0].path === "/mnt/project", "settings snapshot mount path mismatch");
assert(snapshot.lifecycle.state === "recovered", "settings snapshot lifecycle state mismatch");
assert(snapshot.recovery.lastRecovery.recoveredAt, "settings snapshot recovery status missing");
assert(snapshot.coordination.role === "secondary", "settings snapshot coordination role mismatch");

const markup = settingsRuntimeMarkup(snapshot);

assert(markup.includes("<dt>User</dt><dd>guest</dd>"), "settings markup did not render session user");
assert(markup.includes("<dt>Apps</dt><dd>2</dd>"), "settings markup did not render app count");
assert(markup.includes("<dt>Packages</dt><dd>1</dd>"), "settings markup did not render package count");
assert(markup.includes("<dt>Processes</dt><dd>3</dd>"), "settings markup did not render process count");
assert(markup.includes("<dt>Services</dt><dd>1</dd>"), "settings markup did not render service count");
assert(markup.includes("<dt>Lifecycle</dt><dd>recovered</dd>"), "settings markup did not render lifecycle state");
assert(markup.includes("<dt>Session Role</dt><dd>secondary</dd>"), "settings markup did not render session role");
assert(markup.includes("<dt>Lock Owner</dt><dd>primary-tab</dd>"), "settings markup did not render lock owner");
assert(markup.includes("<dt>Channel</dt><dd>connected · received=2</dd>"), "settings markup did not render channel diagnostics");
assert(markup.includes("<dt>Conflicts</dt><dd>1 pending · total=3</dd>"), "settings markup did not render conflict diagnostics");
assert(markup.includes("<dt>Peer Flush</dt><dd>primary-tab · complete</dd>"), "settings markup did not render peer flush diagnostics");
assert(markup.includes("<dt>Peer App State</dt><dd>api-lab · set</dd>"), "settings markup did not render app-state diagnostics");
assert(markup.includes("recovered"), "settings markup did not render recovery summary");
assert(markup.includes("unsupported-after-close=worker execution"), "settings markup did not render closed-page unsupported diagnostics");
assert(markup.includes("opfs"), "settings markup did not render storage backend");
assert(markup.includes("pending=true"), "settings markup did not render pending storage state");
assert(markup.includes("/home/guest/Desktop"), "settings markup did not render desktop path");
assert(markup.includes("Project"), "settings markup did not render mount handle");
assert(markup.includes("/mnt/project"), "settings markup did not render mount path");
assert(markup.includes("Search Indexer"), "settings markup did not render service name");
assert(markup.includes('data-settings-action="service-restart"'), "settings markup did not expose service restart action");
assert(markup.includes('data-settings-action="service-disable"'), "settings markup did not expose service disable action");
assert(markup.includes('data-settings-action="flush-storage"'), "settings markup did not expose storage action");
assert(markup.includes('data-settings-action="restore-mounts"'), "settings markup did not expose mount action");

console.log("settings smoke ok runtime snapshot");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
