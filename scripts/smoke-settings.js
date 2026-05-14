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
  keychain: 0,
  browser: 0,
  sync: 0,
  syncMerge: 0,
  syncConflicts: 0,
  storageKernel: 0,
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
      packageOperation: { lastPeerPackageId: "api-lab", lastPeerOperation: "install", lastPeerPhase: "complete" },
      handoff: {
        activeOfferId: "handoff-1",
        activeMode: "control",
        activePeerInstanceId: "primary-tab",
        relay: {
          framesSent: 1,
          framesReceived: 2,
          inputsSent: 1,
          inputsReceived: 1,
          lastTransport: "broadcast-channel",
        },
      },
      recovery: { recovered: true, pendingConflicts: 2 },
    };
  },
  remoteSyncStatus() {
    calls.sync += 1;
    return {
      backend: "storage-value",
      encrypted: true,
      mergeRuleCount: 6,
      lastSuccessfulSnapshot: {
        id: "sync-smoke",
        createdAt: "2026-05-05T00:01:00.000Z",
        fileCount: 4,
        bytes: 128,
        cacheRecords: 1,
        settingsRecords: 2,
      },
      lastAppliedSnapshot: {
        id: "sync-smoke",
        appliedAt: "2026-05-05T00:03:00.000Z",
        conflicts: 1,
        refused: 2,
        refusedRecords: [
          { path: "/var/lib/dindbos/packages/api-lab.json", scope: "package-metadata" },
        ],
      },
      lastApplyRun: {
        status: "interrupted",
        nextIndex: 2,
        totalFiles: 4,
      },
      lastRetry: {
        retriedAt: "2026-05-05T00:05:00.000Z",
        applied: 1,
        refused: 0,
      },
      lastRepair: {
        resolvedAt: "2026-05-05T00:04:00.000Z",
        remainingConflicts: 0,
      },
      lastError: "",
    };
  },
  remoteSyncMergePolicy() {
    calls.syncMerge += 1;
    return { planner: "offline-first", rules: [{ scope: "user-documents" }, { scope: "package-metadata" }] };
  },
  listRemoteSyncConflicts() {
    calls.syncConflicts += 1;
    return [{
      path: "/home/guest/Documents/.sync-conflicts/note.txt.2026.remote",
      targetPath: "/home/guest/Documents/note.txt",
      bytes: 12,
    }];
  },
  storageKernelStatus() {
    calls.storageKernel += 1;
    return {
      state: "writeback-pending",
      pageCache: {
        format: "opfs-inode-records",
        bytes: 4096,
        contentBytes: 2048,
        dirtyInodes: 2,
        dirtyFiles: 1,
      },
      writeback: {
        backend: "opfs",
        pending: true,
        flushes: 2,
        coalesced: 1,
        lastError: "",
      },
      recovery: {
        lastRepair: {
          checkedAt: "2026-05-05T00:10:00.000Z",
          ok: false,
          problems: 1,
          repairs: 1,
        },
      },
      conflicts: {
        localMounts: [{ path: "/mnt/project/note.txt" }],
        remoteSync: [{ path: "/home/guest/Documents/.sync-conflicts/note.txt.2026.remote" }],
      },
      transactions: [{ id: "storage-runtime-tx-1", status: "committed" }],
      transactionGroups: [{
        id: "storage-runtime-group-1",
        kind: "mapped-file-write",
        status: "committed",
        startedAt: "2026-05-05T00:09:00.000Z",
        transactionIds: ["storage-runtime-tx-1"],
      }],
    };
  },
  keychain: {
    settingsStatus() {
      calls.keychain += 1;
      return {
        locked: false,
        records: 2,
        activeGrants: [
          {
            name: "registry.token",
            kind: "repository-token",
            appId: "secret-package",
            grantedAt: "2026-05-05T00:02:00.000Z",
            expiresAt: "2026-05-05T00:12:00.000Z",
          },
        ],
        deniedRequests: [
          {
            at: "2026-05-05T00:03:00.000Z",
            action: "get",
            name: "api.token",
            requester: "other-app",
            result: "denied",
          },
        ],
        staleCredentials: [
          { name: "old.token", kind: "generic", ownerAppId: "legacy-app", updatedAt: "2025-01-01T00:00:00.000Z" },
        ],
        exportWarnings: ["2 secrets require keychain-mediated export"],
        recoveryWarnings: ["recovery packages must be explicitly exported by the keychain service"],
      };
    },
  },
  browserBrokerStatus() {
    calls.browser += 1;
    return {
      capabilities: [
        { id: "clipboard.read", broker: "clipboard", device: "/dev/browser/clipboard", available: true, accessCount: 2, revoked: 0 },
        { id: "screen.capture", broker: "screen-capture", device: "/dev/browser/screen", available: true, accessCount: 1, revoked: 1 },
      ],
      ledgerEntries: [
        { capability: "clipboard.read", operation: "read", result: "ok", pid: 42, broker: "clipboard", device: "/dev/browser/clipboard", at: "2026-05-05T00:08:00.000Z" },
      ],
      revokedGrants: [
        { capability: "screen.capture", pid: 42, appId: "recorder", revokedAt: "2026-05-05T00:09:00.000Z" },
      ],
    };
  },
  fs: {
    exists(path) {
      return path === "/var/log/dindbos/package-container.log";
    },
    readFile(path) {
      if (path !== "/var/log/dindbos/package-container.log") throw new Error(`unexpected read ${path}`);
      return [
        JSON.stringify({ at: "2026-05-05T00:06:00.000Z", pid: 42, appId: "iframe-heartbeat", packageId: "iframe-heartbeat", type: "heartbeat", status: "ok" }),
        JSON.stringify({ at: "2026-05-05T00:07:00.000Z", pid: 43, appId: "iframe-crash", packageId: "iframe-crash", type: "crash", status: "error", code: "ECONTAINER", message: "iframe deliberate crash" }),
      ].join("\n");
    },
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
assert(calls.sync === 1, "settings snapshot did not read remote sync status");
assert(calls.syncMerge === 1, "settings snapshot did not read remote sync merge policy");
assert(calls.syncConflicts === 1, "settings snapshot did not read remote sync conflicts");
assert(calls.storageKernel === 1, "settings snapshot did not read storage kernel status");
assert(calls.keychain === 1, "settings snapshot did not read keychain status");
assert(calls.browser === 1, "settings snapshot did not read browser broker status");

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
assert(snapshot.sync.lastSuccessfulSnapshot.fileCount === 4, "settings snapshot sync status mismatch");
assert(snapshot.sync.lastSuccessfulSnapshot.cacheRecords === 1, "settings snapshot sync cache coverage mismatch");
assert(snapshot.sync.lastSuccessfulSnapshot.settingsRecords === 2, "settings snapshot sync settings coverage mismatch");
assert(snapshot.syncMerge.planner === "offline-first", "settings snapshot sync merge policy mismatch");
assert(snapshot.syncConflicts.length === 1, "settings snapshot sync conflict count mismatch");
assert(snapshot.storageKernel.state === "writeback-pending", "settings snapshot storage kernel state mismatch");
assert(snapshot.keychain.activeGrants.length === 1, "settings snapshot keychain grant count mismatch");
assert(snapshot.browser.capabilities.length === 2, "settings snapshot browser broker count mismatch");
assert(snapshot.containerEvents.length === 2, "settings snapshot container security event count mismatch");

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
assert(markup.includes("<dt>Peer Package</dt><dd>api-lab · install · complete</dd>"), "settings markup did not render package operation diagnostics");
assert(markup.includes("<dt>Session Handoff</dt><dd>active · control · peer=primary-tab</dd>"), "settings markup did not render session handoff diagnostics");
assert(markup.includes("<dt>Handoff Relay</dt><dd>frames=3 · inputs=2 · transport=broadcast-channel</dd>"), "settings markup did not render session handoff relay diagnostics");
assert(markup.includes("<dt>Session Recovery</dt><dd>recovered · conflicts=2</dd>"), "settings markup did not render session recovery diagnostics");
assert(markup.includes("<dt>Sync</dt><dd>storage-value encrypted=true") && markup.includes("files=4 cache=1 settings=2</dd>"), "settings markup did not render sync summary");
assert(markup.includes("<dt>Last Snapshot</dt><dd>") && markup.includes("· files=4 · cache=1 · settings=2</dd>"), "settings markup did not render remote sync panel");
assert(markup.includes("<dt>Last Applied</dt><dd>") && markup.includes("· conflicts=1 · refused=2</dd>"), "settings markup did not render remote sync apply status");
assert(markup.includes("<dt>Refused Records</dt><dd>1</dd>"), "settings markup did not render remote sync refused record count");
assert(markup.includes("<dt>Apply Run</dt><dd>interrupted · next=2/4</dd>"), "settings markup did not render remote sync apply run status");
assert(markup.includes("<dt>Last Retry</dt><dd>") && markup.includes("· applied=1 · refused=0</dd>"), "settings markup did not render remote sync retry status");
assert(markup.includes("<dt>Last Repair</dt><dd>") && markup.includes("· remaining=0</dd>"), "settings markup did not render remote sync repair status");
assert(markup.includes("<dt>Merge Rules</dt><dd>6</dd>"), "settings markup did not render remote sync merge rules");
assert(markup.includes("<h3>Keychain</h3>"), "settings markup did not render keychain panel");
assert(markup.includes("<h3>Browser Permissions</h3>"), "settings markup did not render browser permission panel");
assert(markup.includes('data-browser-capability="screen.capture"'), "settings markup did not render browser capability entry");
assert(markup.includes('data-privacy-ledger="clipboard.read"'), "settings markup did not render browser privacy ledger entry");
assert(markup.includes("<dt>Revoked</dt><dd>1</dd>"), "settings markup did not render browser revoked count");
assert(markup.includes("<h3>Container Security</h3>"), "settings markup did not render container security panel");
assert(markup.includes('data-container-event="heartbeat"'), "settings markup did not render container heartbeat event");
assert(markup.includes('data-container-event="crash"'), "settings markup did not render container crash event");
assert(markup.includes("ECONTAINER"), "settings markup did not render container crash code");
assert(markup.includes("<dt>Active Grants</dt><dd>1</dd>"), "settings markup did not render keychain active grant count");
assert(markup.includes("<dt>Denied Requests</dt><dd>1</dd>"), "settings markup did not render keychain denied request count");
assert(markup.includes("<dt>Stale Credentials</dt><dd>1</dd>"), "settings markup did not render keychain stale credential count");
assert(markup.includes("2 secrets require keychain-mediated export"), "settings markup did not render keychain export warning");
assert(markup.includes("recovery packages must be explicitly exported"), "settings markup did not render keychain recovery warning");
assert(markup.includes('data-keychain-grant="registry.token"'), "settings markup did not render active keychain grant");
assert(markup.includes('data-keychain-denied="api.token"'), "settings markup did not render denied keychain request");
assert(markup.includes('data-sync-action="use-conflict"') && markup.includes('data-sync-action="keep-local"') && markup.includes('data-sync-action="delete-conflict"'), "settings markup did not render sync repair actions");
assert(markup.includes("/home/guest/Documents/note.txt"), "settings markup did not render sync conflict target");
assert(markup.includes("recovered"), "settings markup did not render recovery summary");
assert(markup.includes("unsupported-after-close=worker execution"), "settings markup did not render closed-page unsupported diagnostics");
assert(markup.includes("opfs"), "settings markup did not render storage backend");
assert(markup.includes("pending=true"), "settings markup did not render pending storage state");
assert(markup.includes("<h3>Storage Recovery</h3>"), "settings markup did not render storage recovery panel");
assert(markup.includes("<dt>Page Cache</dt><dd>2 dirty inodes · 1 dirty files"), "settings markup did not render storage page-cache diagnostics");
assert(markup.includes("<dt>Writeback</dt><dd>pending · flushes=2 · coalesced=1</dd>"), "settings markup did not render storage writeback diagnostics");
assert(markup.includes('data-storage-group="storage-runtime-group-1"'), "settings markup did not render storage transaction group");
assert(markup.includes('data-settings-action="storage-fsck-dry-run"'), "settings markup did not expose storage fsck dry-run action");
assert(markup.includes('data-settings-action="storage-fsck-repair"'), "settings markup did not expose storage fsck repair action");
assert(markup.includes('data-settings-action="storage-fsck-salvage"'), "settings markup did not expose storage salvage action");
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
