import { AppRegistry } from "./app-registry.js?v=20260422-browserd";
import { AppSandbox } from "./app-sandbox.js?v=20260422-browserd";
import { compatibilitySnapshot } from "./compat.js?v=20260422-browserd";
import { DescriptorManager } from "./descriptors.js?v=20260422-browserd";
import { RuntimeCacheStore } from "./cache-store.js?v=20260422-browserd";
import { DesktopShell } from "./desktop-shell.js?v=20260422-browserd";
import { EventBus } from "./event-bus.js?v=20260422-browserd";
import { LocalFolderMountManager } from "./local-folder-mount.js?v=20260422-browserd";
import { NodeCompat } from "./node-compat.js?v=20260422-browserd";
import { NpmInstaller } from "./npm-installer.js?v=20260422-browserd";
import { PackageManager } from "./package-manager.js?v=20260422-browserd";
import { PermissionPolicy } from "./permission-policy.js?v=20260422-browserd";
import { PersistentStorage } from "./persistent-storage.js?v=20260422-browserd";
import { ProcessExecutor } from "./process-executor.js?v=20260422-browserd";
import { ProcessManager } from "./process-manager.js?v=20260422-browserd";
import { ServiceManager } from "./service-manager.js?v=20260422-browserd";
import { SyscallDispatcher } from "./syscalls.js?v=20260422-browserd";
import { VirtualFileSystem } from "./vfs.js?v=20260422-browserd";
import { WasmRunner } from "./wasm-runner.js?v=20260422-browserd";
import { WindowManager } from "./window-manager.js?v=20260422-browserd";

export const BOOT_PHASES = [
  { id: "storage-load", label: "Storage load" },
  { id: "vfs-mount", label: "VFS mount" },
  { id: "package-registry-load", label: "Package registry load" },
  { id: "app-registry-load", label: "App registry load" },
  { id: "process-init", label: "Process init" },
  { id: "desktop-render", label: "Desktop render" },
];

export const DISK_POLICY_AREAS = [
  { root: "/home", type: "user", durability: "persistent", policy: "browser-backed user files" },
  { root: "/opt", type: "packages", durability: "persistent", policy: "installed package files" },
  { root: "/var/cache", type: "cache", durability: "evictable", policy: "package and document cache" },
  { root: "/var", type: "runtime", durability: "persistent", policy: "runtime records and logs" },
  { root: "/tmp", type: "temporary", durability: "session", policy: "scratch files" },
  { root: "/mnt", type: "external", durability: "user-granted", policy: "local and virtual mounts" },
];

export const OS_LIFECYCLE_STATES = [
  "booting",
  "active",
  "idle",
  "suspending",
  "suspended",
  "resuming",
  "shutting-down",
  "crashed",
  "recovered",
];

const RECOVERY_DIR = "/var/run/dindbos/recovery";
const LAST_SHUTDOWN_RECOVERY_PATH = `${RECOVERY_DIR}/last-shutdown.json`;
const LAST_RECOVERY_PATH = `${RECOVERY_DIR}/last-recovery.json`;
const SESSION_LOCK_STORAGE_KEY = "dindbos:session-lock";

export class DindbOS {
  constructor(options = {}) {
    this.root = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
    this.instanceId = String(options.instanceId || `runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    this.session = normalizeSession(options.session || {});
    this.sessionLockTtlMs = Number(options.sessionLockTtlMs || 30_000);
    this.sessionCoordination = {
      instanceId: this.instanceId,
      role: "unknown",
      lockOwner: "",
      lockExpiresAt: "",
      readonly: false,
      staleRecovered: false,
      updatedAt: new Date().toISOString(),
    };
    this.sessionAuth = {
      state: this.session.locked ? "locked" : "authenticated",
      locked: Boolean(this.session.locked),
      lockedAt: this.session.locked ? new Date().toISOString() : "",
      unlockedAt: this.session.locked ? "" : new Date().toISOString(),
      reason: this.session.lockReason || "",
    };
    this.bus = new EventBus();
    this.sessionChannelName = options.sessionChannelName || "dindbos:session-events";
    this.sessionChannel = null;
    this.sessionMessages = [];
    this.sessionChannelStatus = {
      supported: false,
      connected: false,
      lastSentAt: "",
      lastReceivedAt: "",
      received: 0,
      sent: 0,
    };
    this.sessionFileChanges = new Map();
    this.sessionConflicts = [];
    this.sessionStorageFlushes = new Map();
    this.sessionStorageFlushStatus = {
      localFlushes: 0,
      peerFlushes: 0,
      lastLocalPhase: "",
      lastLocalAt: "",
      lastPeerSource: "",
      lastPeerPhase: "",
      lastPeerAt: "",
    };
    this.sessionAppStateChanges = new Map();
    this.sessionAppStateStatus = {
      localChanges: 0,
      peerChanges: 0,
      lastLocalAppId: "",
      lastLocalAction: "",
      lastLocalAt: "",
      lastPeerSource: "",
      lastPeerAppId: "",
      lastPeerAction: "",
      lastPeerAt: "",
    };
    this.sessionPackageOperations = new Map();
    this.sessionPackageOperationStatus = {
      localOperations: 0,
      peerOperations: 0,
      lastLocalPackageId: "",
      lastLocalOperation: "",
      lastLocalPhase: "",
      lastLocalAt: "",
      lastPeerSource: "",
      lastPeerPackageId: "",
      lastPeerOperation: "",
      lastPeerPhase: "",
      lastPeerAt: "",
    };
    this.permissions = new PermissionPolicy({ defaultUser: this.session.user, defaultGroups: this.session.groups });
    this.storage = options.storage || new PersistentStorage({ key: options.storageKey || "dindbos:vfs" });
    this.cache = options.cache || new RuntimeCacheStore({ name: options.cacheName || "dindbos-runtime-cache-v1" });
    this.clipboard = options.clipboard || createRuntimeClipboard(options.clipboardText || "");
    this.pty = options.pty || createRuntimePtyManager();
    this.browserProvider = {
      url: normalizeBrowserProviderUrl(options.browserProviderUrl),
      label: options.browserProviderLabel || "Local browserd",
    };
    this.persistDelayMs = options.persistDelayMs ?? 120;
    this.persistTimer = null;
    this.persistPending = false;
    this.persisting = false;
    this.persistRequestedDuringFlush = false;
    this.persistenceHooksInstalled = false;
    this.serviceLifecycleHooksInstalled = false;
    this.lifecycleState = {
      state: "booting",
      previousState: "",
      reason: "constructor",
      updatedAt: new Date().toISOString(),
    };
    this.lifecycleTransitions = [{ ...this.lifecycleState }];
    this.persistenceStats = {
      scheduled: 0,
      coalesced: 0,
      flushed: 0,
      lastAction: "",
      lastPath: "",
      lastFlushStartedAt: "",
      lastFlushedAt: "",
      lastFlushDurationMs: 0,
      lastFlushError: "",
    };
    this.initialFileSystem = options.fileSystem;
    this.fs = this.createFileSystem(options.fileSystem);
    this.installSessionChannel(options.broadcastChannelFactory);
    this.shell = new DesktopShell(this);
    this.windows = new WindowManager(this);
    this.processes = new ProcessManager(this);
    this.services = new ServiceManager(this);
    this.executor = new ProcessExecutor(this);
    this.descriptors = new DescriptorManager(this);
    this.syscalls = new SyscallDispatcher(this);
    this.apps = new AppRegistry(this);
    this.packages = new PackageManager(this);
    this.npm = new NpmInstaller(this);
    this.node = new NodeCompat(this);
    this.wasm = new WasmRunner(this);
    this.localMounts = new LocalFolderMountManager(this, options.localMounts || {});
    this.bootPhases = new Map(BOOT_PHASES.map((phase, index) => [phase.id, {
      ...phase,
      index,
      status: "pending",
      detail: "",
      startedAt: "",
      finishedAt: "",
      durationMs: 0,
      error: "",
    }]));
  }

  createFileSystem(rootNode) {
    return new VirtualFileSystem(rootNode, {
      home: this.session.home,
      policy: this.permissions,
      onChange: (event) => {
        this.schedulePersistFileSystem(event);
        const message = this.publishSessionEvent("file-change", event);
        this.recordSessionFileChange(this.instanceId, event, message?.at);
      },
    });
  }

  installSessionChannel(factory = null) {
    const Channel = factory || globalThis.BroadcastChannel;
    this.sessionChannelStatus.supported = typeof Channel === "function";
    if (this.sessionChannel || typeof Channel !== "function") return;
    this.sessionChannel = new Channel(this.sessionChannelName);
    this.sessionChannel.unref?.();
    this.sessionChannelStatus.connected = true;
    const receive = (event) => this.handleSessionMessage(event?.data ?? event);
    if (typeof this.sessionChannel.addEventListener === "function") {
      this.sessionChannel.addEventListener("message", receive);
    } else {
      this.sessionChannel.onmessage = receive;
    }
  }

  publishSessionEvent(type, payload = {}) {
    if (!this.sessionChannel?.postMessage) return null;
    const message = {
      source: this.instanceId,
      type,
      at: new Date().toISOString(),
      payload: payload && typeof payload === "object" ? { ...payload } : { value: payload },
    };
    this.sessionChannel.postMessage(message);
    this.sessionChannelStatus.sent += 1;
    this.sessionChannelStatus.lastSentAt = message.at;
    return message;
  }

  handleSessionMessage(message) {
    if (!message || typeof message !== "object" || message.source === this.instanceId) return null;
    this.sessionMessages.push({ ...message });
    this.sessionMessages = this.sessionMessages.slice(-100);
    this.sessionChannelStatus.received += 1;
    this.sessionChannelStatus.lastReceivedAt = message.at || new Date().toISOString();
    this.bus.emit("session:message", { ...message });
    if (message.type === "file-change") {
      const conflict = this.recordSessionFileChange(message.source, message.payload, message.at);
      const event = { ...message.payload, source: message.source, at: message.at };
      if (conflict) event.conflict = conflict;
      this.bus.emit("session:file-change", event);
    }
    if (message.type === "storage-flush") this.recordSessionStorageFlush(message.source, message.payload, message.at);
    if (message.type === "app-state") this.recordSessionAppStateChange(message.source, message.payload, message.at);
    if (message.type === "package-operation") this.recordSessionPackageOperation(message.source, message.payload, message.at);
    return message;
  }

  publishSessionPackageOperation(operation, details = {}) {
    const at = new Date().toISOString();
    const payload = {
      operation: String(operation || "package"),
      phase: String(details.phase || "complete"),
      packageId: String(details.packageId || ""),
      appId: String(details.appId || ""),
      version: String(details.version || ""),
      error: String(details.error || ""),
    };
    this.sessionPackageOperationStatus.localOperations += 1;
    this.sessionPackageOperationStatus.lastLocalPackageId = payload.packageId;
    this.sessionPackageOperationStatus.lastLocalOperation = payload.operation;
    this.sessionPackageOperationStatus.lastLocalPhase = payload.phase;
    this.sessionPackageOperationStatus.lastLocalAt = at;
    return this.publishSessionEvent("package-operation", payload);
  }

  recordSessionPackageOperation(source, payload = {}, at = "") {
    const entry = {
      source: String(source || "unknown"),
      operation: String(payload.operation || "package"),
      phase: String(payload.phase || "unknown"),
      packageId: String(payload.packageId || ""),
      appId: String(payload.appId || ""),
      version: String(payload.version || ""),
      error: String(payload.error || ""),
      at: at || new Date().toISOString(),
    };
    if (!entry.packageId) return null;
    this.sessionPackageOperations.set(`${entry.source}:${entry.packageId}:${entry.operation}`, entry);
    this.sessionPackageOperationStatus.peerOperations += 1;
    this.sessionPackageOperationStatus.lastPeerSource = entry.source;
    this.sessionPackageOperationStatus.lastPeerPackageId = entry.packageId;
    this.sessionPackageOperationStatus.lastPeerOperation = entry.operation;
    this.sessionPackageOperationStatus.lastPeerPhase = entry.phase;
    this.sessionPackageOperationStatus.lastPeerAt = entry.at;
    this.bus.emit("session:package-operation", { ...entry });
    return entry;
  }

  publishSessionAppStateChange(action, details = {}) {
    const at = new Date().toISOString();
    const payload = {
      action: String(action || "change"),
      appId: String(details.appId || ""),
      key: String(details.key || ""),
      path: String(details.path || ""),
      updatedAt: String(details.updatedAt || at),
    };
    this.sessionAppStateStatus.localChanges += 1;
    this.sessionAppStateStatus.lastLocalAppId = payload.appId;
    this.sessionAppStateStatus.lastLocalAction = payload.action;
    this.sessionAppStateStatus.lastLocalAt = at;
    return this.publishSessionEvent("app-state", payload);
  }

  recordSessionAppStateChange(source, payload = {}, at = "") {
    const entry = {
      source: String(source || "unknown"),
      action: String(payload.action || "change"),
      appId: String(payload.appId || ""),
      key: String(payload.key || ""),
      path: String(payload.path || ""),
      updatedAt: String(payload.updatedAt || at || ""),
      at: at || new Date().toISOString(),
    };
    if (!entry.appId) return null;
    this.sessionAppStateChanges.set(`${entry.source}:${entry.appId}`, entry);
    this.sessionAppStateStatus.peerChanges += 1;
    this.sessionAppStateStatus.lastPeerSource = entry.source;
    this.sessionAppStateStatus.lastPeerAppId = entry.appId;
    this.sessionAppStateStatus.lastPeerAction = entry.action;
    this.sessionAppStateStatus.lastPeerAt = entry.at;
    this.bus.emit("session:app-state", { ...entry });
    return entry;
  }

  publishSessionStorageFlush(phase, extra = {}) {
    const at = new Date().toISOString();
    const payload = {
      phase,
      pending: this.persistPending || Boolean(this.persistTimer),
      inFlight: this.persisting,
      flushes: this.persistenceStats.flushed,
      lastPath: this.persistenceStats.lastPath,
      lastAction: this.persistenceStats.lastAction,
      error: extra.error || "",
    };
    this.sessionStorageFlushStatus.lastLocalPhase = phase;
    this.sessionStorageFlushStatus.lastLocalAt = at;
    if (phase === "complete") this.sessionStorageFlushStatus.localFlushes += 1;
    return this.publishSessionEvent("storage-flush", payload);
  }

  recordSessionStorageFlush(source, payload = {}, at = "") {
    const entry = {
      source: String(source || "unknown"),
      phase: String(payload.phase || "unknown"),
      at: at || new Date().toISOString(),
      pending: Boolean(payload.pending),
      inFlight: Boolean(payload.inFlight),
      flushes: Number(payload.flushes || 0),
      lastPath: String(payload.lastPath || ""),
      error: String(payload.error || ""),
    };
    this.sessionStorageFlushes.set(entry.source, entry);
    this.sessionStorageFlushStatus.peerFlushes += 1;
    this.sessionStorageFlushStatus.lastPeerSource = entry.source;
    this.sessionStorageFlushStatus.lastPeerPhase = entry.phase;
    this.sessionStorageFlushStatus.lastPeerAt = entry.at;
    this.bus.emit("session:storage-flush", { ...entry });
    return entry;
  }

  recordSessionFileChange(source, event = {}, at = "") {
    const path = event?.path ? String(event.path) : "";
    if (!this.shouldTrackSessionFileConflict(path)) return null;
    const entry = {
      source: String(source || "unknown"),
      action: String(event.action || "change"),
      path,
      at: at || new Date().toISOString(),
    };
    const previous = this.sessionFileChanges.get(path);
    this.sessionFileChanges.set(path, entry);
    if (!previous || previous.source === entry.source) return null;
    const conflict = {
      id: `${path}:${previous.source}:${previous.at}:${entry.source}:${entry.at}`,
      path,
      firstSource: previous.source,
      firstAction: previous.action,
      firstAt: previous.at,
      secondSource: entry.source,
      secondAction: entry.action,
      secondAt: entry.at,
      status: "pending",
    };
    if (this.sessionConflicts.some((item) => item.id === conflict.id)) return null;
    this.sessionConflicts.push(conflict);
    this.sessionConflicts = this.sessionConflicts.slice(-50);
    this.bus.emit("session:conflict", { ...conflict });
    this.writeSessionCoordinationStatus();
    return conflict;
  }

  shouldTrackSessionFileConflict(path) {
    if (!path || path.startsWith("/proc")) return false;
    if (path.startsWith("/var/run/dindbos")) return false;
    return path.startsWith("/home") || path.startsWith("/opt") || path.startsWith("/var/lib") || path.startsWith("/mnt");
  }

  async loadPersistentFileSystem(options = {}) {
    const recover = options.recover !== false;
    try {
      await this.runBootPhase("storage-load", async () => {
        const storedFileSystem = await this.storage.loadFileSystem();
        if (storedFileSystem) this.fs = this.createFileSystem(storedFileSystem);
        return storedFileSystem ? "restored persisted filesystem" : "using initial filesystem";
      });
    } catch (error) {
      if (!recover) throw error;
      this.fs = this.createFileSystem(this.initialFileSystem);
      this.recoverBootPhase("storage-load", "storage load failed; recovered with initial filesystem", error);
    }
    try {
      await this.runBootPhase("vfs-mount", async () => {
        await this.localMounts.restorePersistedMounts();
        return "filesystem and persisted local mounts ready";
      });
    } catch (error) {
      if (!recover) throw error;
      this.recoverBootPhase("vfs-mount", "local mount restore failed; continuing without persisted mounts", error);
    }
    this.ensureDiskPolicyRoots();
    this.ensureUserGroupDatabase();
    this.ensureSessionHome();
    this.writeSessionStatus();
    await this.coordinateSessionLock();
    this.writeSessionStatus();
    this.recoverPreviousShutdown();
  }

  boot() {
    if (!this.root) throw new Error("DindbOS root element was not found.");
    this.runBootPhaseSync("process-init", () => {
      this.processes.syncProcfs();
      return "process table and /proc ready";
    });
    this.runBootPhaseSync("desktop-render", () => {
      this.shell.mount(this.root);
      this.windows.mount(this.shell.refs.windowLayer, this.shell.refs.taskStrip);
      this.shell.renderDesktop();
      this.shell.renderDock();
      return "desktop shell, dock, and window layer ready";
    });
    this.installServiceLifecycleHooks();
    this.installPersistenceLifecycleHooks();
    this.transitionLifecycle("active", "boot-complete");
    this.writeBootDiagnostics();
    this.bus.emit("boot", { session: this.session, phases: this.bootStatus() });
  }

  async runBootPhase(id, action) {
    this.startBootPhase(id);
    const startedAt = Date.now();
    try {
      const detail = await action();
      return this.finishBootPhase(id, "complete", detail, startedAt);
    } catch (error) {
      this.finishBootPhase(id, "error", "", startedAt, error);
      throw error;
    }
  }

  runBootPhaseSync(id, action) {
    this.startBootPhase(id);
    const startedAt = Date.now();
    try {
      const detail = action();
      return this.finishBootPhase(id, "complete", detail, startedAt);
    } catch (error) {
      this.finishBootPhase(id, "error", "", startedAt, error);
      throw error;
    }
  }

  startBootPhase(id) {
    const phase = this.bootPhases.get(id);
    if (!phase) throw new Error(`unknown boot phase: ${id}`);
    Object.assign(phase, {
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: "",
      durationMs: 0,
      error: "",
    });
    this.bus.emit("boot:phase", { ...phase });
    return { ...phase };
  }

  finishBootPhase(id, status, detail = "", startedAt = Date.now(), error = null) {
    const phase = this.bootPhases.get(id);
    if (!phase) throw new Error(`unknown boot phase: ${id}`);
    Object.assign(phase, {
      status,
      detail: detail || (status === "complete" ? `${phase.label} complete` : ""),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      error: error ? error.message || String(error) : "",
    });
    this.bus.emit("boot:phase", { ...phase });
    return { ...phase };
  }

  recoverBootPhase(id, detail, error = null) {
    const phase = this.bootPhases.get(id);
    if (!phase) throw new Error(`unknown boot phase: ${id}`);
    Object.assign(phase, {
      status: "recovered",
      detail,
      finishedAt: new Date().toISOString(),
      error: error ? error.message || String(error) : phase.error,
    });
    this.bus.emit("boot:phase", { ...phase });
    return { ...phase };
  }

  bootStatus() {
    return [...this.bootPhases.values()]
      .sort((left, right) => left.index - right.index)
      .map((phase) => ({ ...phase }));
  }

  lifecycleStatus() {
    return {
      ...this.lifecycleState,
      transitions: this.lifecycleTransitions.map((entry) => ({ ...entry })),
    };
  }

  transitionLifecycle(state, reason = "") {
    if (!OS_LIFECYCLE_STATES.includes(state)) throw new Error(`unknown lifecycle state: ${state}`);
    const previousState = this.lifecycleState?.state || "";
    const entry = {
      state,
      previousState,
      reason: String(reason || ""),
      updatedAt: new Date().toISOString(),
    };
    this.lifecycleState = entry;
    this.lifecycleTransitions.push(entry);
    this.lifecycleTransitions = this.lifecycleTransitions.slice(-50);
    this.processes?.applyLifecycleTransition?.(state, entry.reason);
    this.bus.emit("os:lifecycle", this.lifecycleStatus());
    this.writeLifecycleDiagnostics();
    return this.lifecycleStatus();
  }

  writeLifecycleDiagnostics() {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/var", "root", system);
    this.ensureSystemDirectory("/var/run", "root", system);
    this.ensureSystemDirectory("/var/run/dindbos", "root", system);
    this.ensureSystemDirectory("/var/log", "root", system);
    this.ensureSystemDirectory("/var/log/dindbos", "root", system);
    const status = this.lifecycleStatus();
    this.fs.writeOrCreateFile("/var/run/dindbos/lifecycle.json", `${JSON.stringify(status, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    const line = `${status.updatedAt} ${status.previousState || "-"} -> ${status.state} ${status.reason}\n`;
    if (this.fs.exists("/var/log/dindbos/lifecycle.log")) {
      this.fs.appendFile("/var/log/dindbos/lifecycle.log", line, "/", system);
    } else {
      this.fs.writeOrCreateFile("/var/log/dindbos/lifecycle.log", line, "/", {
        owner: "root",
        group: "root",
        permissions: "-rw-r--r--",
        mime: "text/plain",
      }, system);
    }
  }

  readLastShutdownRecord() {
    if (!this.fs.exists(LAST_SHUTDOWN_RECOVERY_PATH)) return null;
    try {
      return JSON.parse(this.fs.readFile(LAST_SHUTDOWN_RECOVERY_PATH, "/", this.permissions.systemPrincipal()));
    } catch {
      return null;
    }
  }

  readLastRecoveryRecord() {
    if (!this.fs.exists(LAST_RECOVERY_PATH)) return null;
    try {
      return JSON.parse(this.fs.readFile(LAST_RECOVERY_PATH, "/", this.permissions.systemPrincipal()));
    } catch {
      return null;
    }
  }

  recoveryStatus() {
    const lastShutdown = this.readLastShutdownRecord();
    const lastRecovery = this.readLastRecoveryRecord();
    return {
      lastShutdown,
      lastRecovery,
      closedPagePersistence: false,
      unsupportedAfterClose: [
        "javascript timers",
        "worker execution",
        "service processes without browser-supported background APIs",
        "unflushed async storage work after the browser stops the page",
      ],
      supportedWhileHidden: [
        "best-effort filesystem flush",
        "service suspend/degrade records",
        "recovery records for the next boot",
      ],
    };
  }

  backgroundMaintenanceStatus() {
    const serviceWorkerSupported = Boolean(globalThis.navigator?.serviceWorker);
    const periodicSyncSupported = Boolean(
      globalThis.PeriodicSyncManager
      || globalThis.ServiceWorkerRegistration?.prototype?.periodicSync,
    );
    return {
      serviceWorkerSupported,
      periodicSyncSupported,
      registered: false,
      permissionRequired: serviceWorkerSupported,
      closedPagePersistence: false,
      decision: serviceWorkerSupported
        ? "available-but-not-registered"
        : "unsupported-in-this-runtime",
      reason: serviceWorkerSupported
        ? "DindbOS only enables background maintenance after explicit service registration and permissioned browser support are implemented."
        : "This runtime has no Service Worker controller, so DindbOS cannot claim closed-page service execution.",
    };
  }

  recoverPreviousShutdown() {
    const record = this.readLastShutdownRecord();
    if (!record?.dirtyShutdown || record.recoveredAt) return null;
    const system = this.permissions.systemPrincipal();
    const recoveredAt = new Date().toISOString();
    const recovery = {
      recoveredAt,
      reason: "dirty-shutdown",
      previousShutdown: record,
      action: "recorded browser-interrupted shutdown for user-visible diagnostics",
    };
    this.ensureDirectoryPath(RECOVERY_DIR, {
      leafOwner: "root",
      leafGroup: "root",
      leafPermissions: "drwxr-xr-x",
      principal: system,
    });
    this.fs.writeOrCreateFile(LAST_RECOVERY_PATH, `${JSON.stringify(recovery, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile(LAST_SHUTDOWN_RECOVERY_PATH, `${JSON.stringify({
      ...record,
      dirtyShutdown: false,
      recoveredAt,
      recoveryRecord: LAST_RECOVERY_PATH,
    }, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    this.transitionLifecycle("recovered", "dirty-shutdown");
    return recovery;
  }

  writeRecoveryRecord(reason = "runtime", options = {}) {
    const system = this.permissions.systemPrincipal();
    this.ensureDirectoryPath(RECOVERY_DIR, {
      leafOwner: "root",
      leafGroup: "root",
      leafPermissions: "drwxr-xr-x",
      principal: system,
    });
    const processes = this.processes?.list?.() || [];
    const services = this.services?.list?.() || [];
    const record = {
      recordedAt: new Date().toISOString(),
      reason: String(reason || "runtime"),
      dirtyShutdown: Boolean(options.dirty || this.hasPendingPersistenceWork()),
      lifecycle: { ...this.lifecycleState },
      persistence: this.persistenceStatus(),
      pendingPersistence: this.hasPendingPersistenceWork(),
      suspendedServices: services
        .filter((service) => service.state === "suspended")
        .map((service) => ({ id: service.id, state: service.state, pid: service.pid })),
      workerProcesses: processes
        .filter((process) => process.executionBackend === "worker")
        .map((process) => ({
          pid: process.pid,
          appId: process.appId,
          state: process.state,
          executorState: process.executorState,
        })),
      runningProcesses: processes
        .filter((process) => process.state === "running")
        .map((process) => ({ pid: process.pid, appId: process.appId, runtime: process.runtime })),
    };
    this.fs.writeOrCreateFile(LAST_SHUTDOWN_RECOVERY_PATH, `${JSON.stringify(record, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    return record;
  }

  writeBootDiagnostics() {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/var", "root", system);
    this.ensureSystemDirectory("/var/log", "root", system);
    this.ensureSystemDirectory("/var/log/dindbos", "root", system);
    const phases = this.bootStatus();
    const bootedAt = new Date().toISOString();
    const payload = {
      bootedAt,
      session: {
        user: this.session.user,
        groups: this.session.groups,
        home: this.session.home,
      },
      phases,
      persistence: this.persistenceStatus(),
      storageBuckets: this.storageBucketPolicy(),
    };
    this.fs.writeOrCreateFile("/var/log/dindbos/boot.json", `${JSON.stringify(payload, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/var/log/dindbos/boot.log", `${phases.map((phase) => (
      `[${phase.status}] ${phase.id} ${phase.durationMs}ms ${phase.detail || phase.error}`
    )).join("\n")}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "text/plain",
    }, system);
  }

  ensureDiskPolicyRoots() {
    const system = this.permissions.systemPrincipal();
    DISK_POLICY_AREAS
      .map((area) => area.root)
      .sort((left, right) => left.length - right.length)
      .forEach((root) => this.ensureSystemDirectory(root, "root", system));
  }

  ensureSessionHome() {
    const user = this.session.user || "guest";
    const group = this.session.groups?.[0] || "users";
    const home = this.session.home || `/home/${user}`;
    this.ensureUserHome(user, group, home);
  }

  ensureUserHome(user, group = "users", home = `/home/${user}`) {
    const system = this.permissions.systemPrincipal();
    this.ensureDirectoryPath(home, {
      leafOwner: user,
      leafGroup: group,
      leafPermissions: "drwxr-xr-x",
      principal: system,
    });
    ["Desktop", "Documents", "Downloads", ".Trash"].forEach((name) => {
      this.ensureSystemDirectory(this.fs.join(home, name), user, system, {
        group,
        permissions: "drwxr-xr-x",
      });
    });
    const profilePath = this.fs.join(home, ".profile");
    if (!this.fs.exists(profilePath)) {
      this.fs.writeOrCreateFile(profilePath, [
        `export USER=${user}`,
        `export HOME=${home}`,
        "export SHELL=/bin/dindbsh",
        "",
      ].join("\n"), "/", {
        owner: user,
        group,
        permissions: "-rw-r--r--",
        mime: "text/plain",
      }, system);
    }
  }

  ensureUserGroupDatabase() {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/etc", "root", system);
    this.ensureSystemDirectory("/etc/dindbos", "root", system);
    const database = this.userGroupDatabase();
    const user = this.session.user || "guest";
    const groups = this.session.groups?.length ? this.session.groups : ["users"];
    if (!database.users[user]) {
      database.users[user] = {
        user,
        home: this.session.home || `/home/${user}`,
        groups: [...groups],
        createdAt: new Date().toISOString(),
      };
    }
    groups.forEach((group) => {
      database.groups[group] = database.groups[group] || { group, members: [] };
      if (!database.groups[group].members.includes(user)) database.groups[group].members.push(user);
    });
    this.writeUserGroupDatabase(database);
  }

  userGroupDatabase() {
    const path = "/etc/dindbos/users.json";
    if (!this.fs.exists(path)) return { users: {}, groups: {} };
    try {
      const parsed = JSON.parse(this.fs.readFile(path, "/", this.permissions.systemPrincipal()));
      return {
        users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
        groups: parsed.groups && typeof parsed.groups === "object" ? parsed.groups : {},
      };
    } catch {
      return { users: {}, groups: {} };
    }
  }

  writeUserGroupDatabase(database) {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/etc", "root", system);
    this.ensureSystemDirectory("/etc/dindbos", "root", system);
    const normalized = {
      users: Object.fromEntries(Object.entries(database.users || {}).sort(([left], [right]) => left.localeCompare(right))),
      groups: Object.fromEntries(Object.entries(database.groups || {}).sort(([left], [right]) => left.localeCompare(right))),
      updatedAt: new Date().toISOString(),
    };
    this.fs.writeOrCreateFile("/etc/dindbos/users.json", `${JSON.stringify(normalized, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    return normalized;
  }

  listUsers() {
    return Object.values(this.userGroupDatabase().users).map((user) => ({
      ...user,
      groups: [...(user.groups || [])],
    }));
  }

  listGroups() {
    return Object.values(this.userGroupDatabase().groups).map((group) => ({
      ...group,
      members: [...(group.members || [])],
    }));
  }

  createGroup(name) {
    const group = sanitizeIdentifier(name, "");
    if (!group) throw new Error("group: invalid group name");
    const database = this.userGroupDatabase();
    database.groups[group] = database.groups[group] || { group, members: [], createdAt: new Date().toISOString() };
    this.writeUserGroupDatabase(database);
    return { ...database.groups[group], members: [...(database.groups[group].members || [])] };
  }

  createUser(name, options = {}) {
    const user = sanitizeUserName(name);
    const groups = sanitizeGroups(options.groups?.length ? options.groups : ["users"]);
    const home = normalizeHomePath(options.home, user);
    const database = this.userGroupDatabase();
    if (database.users[user]) throw new Error(`user: ${user}: already exists`);
    database.users[user] = {
      user,
      home,
      groups: [...groups],
      createdAt: new Date().toISOString(),
    };
    groups.forEach((group) => {
      database.groups[group] = database.groups[group] || { group, members: [], createdAt: new Date().toISOString() };
      if (!database.groups[group].members.includes(user)) database.groups[group].members.push(user);
    });
    this.writeUserGroupDatabase(database);
    this.ensureUserHome(user, groups[0] || "users", home);
    return { ...database.users[user], groups: [...database.users[user].groups] };
  }

  addUserToGroup(userName, groupName) {
    const user = sanitizeUserName(userName);
    const group = sanitizeIdentifier(groupName, "");
    if (!group) throw new Error("group: invalid group name");
    const database = this.userGroupDatabase();
    if (!database.users[user]) throw new Error(`user: ${user}: no such user`);
    database.groups[group] = database.groups[group] || { group, members: [], createdAt: new Date().toISOString() };
    if (!database.users[user].groups.includes(group)) database.users[user].groups.push(group);
    if (!database.groups[group].members.includes(user)) database.groups[group].members.push(user);
    this.writeUserGroupDatabase(database);
    return {
      user: { ...database.users[user], groups: [...database.users[user].groups] },
      group: { ...database.groups[group], members: [...database.groups[group].members] },
    };
  }

  removeUserFromGroup(userName, groupName) {
    const user = sanitizeUserName(userName);
    const group = sanitizeIdentifier(groupName, "");
    const database = this.userGroupDatabase();
    if (!database.users[user]) throw new Error(`user: ${user}: no such user`);
    database.users[user].groups = (database.users[user].groups || []).filter((candidate) => candidate !== group);
    if (database.groups[group]) {
      database.groups[group].members = (database.groups[group].members || []).filter((candidate) => candidate !== user);
    }
    this.writeUserGroupDatabase(database);
    return { ...database.users[user], groups: [...database.users[user].groups] };
  }

  sessionStatus() {
    return {
      instanceId: this.instanceId,
      user: this.session.user,
      groups: [...(this.session.groups || [])],
      home: this.session.home,
      state: this.sessionAuth.state,
      locked: this.sessionAuth.locked,
      lockedAt: this.sessionAuth.lockedAt,
      unlockedAt: this.sessionAuth.unlockedAt,
      reason: this.sessionAuth.reason,
      coordination: this.sessionCoordinationStatus(),
    };
  }

  sessionCoordinationStatus() {
    const pendingConflicts = this.sessionConflicts.filter((conflict) => conflict.status === "pending");
    return {
      ...this.sessionCoordination,
      canWrite: this.sessionCoordination.role !== "secondary",
      channel: { ...this.sessionChannelStatus },
      conflicts: {
        total: this.sessionConflicts.length,
        pending: pendingConflicts.length,
        lastConflictAt: pendingConflicts.at(-1)?.secondAt || "",
        items: pendingConflicts.slice(-10).map((conflict) => ({ ...conflict })),
      },
      storageFlush: {
        ...this.sessionStorageFlushStatus,
        peers: [...this.sessionStorageFlushes.values()].map((entry) => ({ ...entry })),
      },
      appState: {
        ...this.sessionAppStateStatus,
        peers: [...this.sessionAppStateChanges.values()].map((entry) => ({ ...entry })),
      },
      packageOperation: {
        ...this.sessionPackageOperationStatus,
        peers: [...this.sessionPackageOperations.values()].map((entry) => ({ ...entry })),
      },
    };
  }

  async coordinateSessionLock(now = Date.now()) {
    const existing = await this.readSessionLock();
    const expired = existing?.expiresAtMs && Number(existing.expiresAtMs) <= now;
    const ownsLock = existing?.owner === this.instanceId;
    const acquired = !existing || expired || ownsLock;
    const updatedAt = new Date(now).toISOString();
    if (acquired) {
      const record = {
        owner: this.instanceId,
        user: this.session.user,
        acquiredAt: ownsLock ? existing.acquiredAt : updatedAt,
        updatedAt,
        expiresAt: new Date(now + this.sessionLockTtlMs).toISOString(),
        expiresAtMs: now + this.sessionLockTtlMs,
        staleRecovered: Boolean(existing && expired && !ownsLock),
      };
      this.storage.writeValue?.(SESSION_LOCK_STORAGE_KEY, JSON.stringify(record));
      this.sessionCoordination = {
        instanceId: this.instanceId,
        role: "primary",
        lockOwner: record.owner,
        lockExpiresAt: record.expiresAt,
        readonly: false,
        staleRecovered: record.staleRecovered,
        updatedAt,
      };
    } else {
      this.sessionCoordination = {
        instanceId: this.instanceId,
        role: "secondary",
        lockOwner: existing.owner || "",
        lockExpiresAt: existing.expiresAt || "",
        readonly: true,
        staleRecovered: false,
        updatedAt,
      };
    }
    this.writeSessionCoordinationStatus();
    this.bus.emit("session:coordination", this.sessionCoordinationStatus());
    return this.sessionCoordinationStatus();
  }

  async readSessionLock() {
    const raw = await this.storage.readValue?.(SESSION_LOCK_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  lockSession(reason = "manual") {
    if (this.sessionAuth.locked) return this.sessionStatus();
    Object.assign(this.sessionAuth, {
      state: "locked",
      locked: true,
      lockedAt: new Date().toISOString(),
      reason: String(reason || "manual"),
    });
    this.writeSessionStatus();
    this.bus.emit("session:lock", this.sessionStatus());
    return this.sessionStatus();
  }

  unlockSession() {
    if (!this.sessionAuth.locked) return this.sessionStatus();
    Object.assign(this.sessionAuth, {
      state: "authenticated",
      locked: false,
      unlockedAt: new Date().toISOString(),
      reason: "",
    });
    this.writeSessionStatus();
    this.bus.emit("session:unlock", this.sessionStatus());
    return this.sessionStatus();
  }

  assertSessionUnlocked(action = "session") {
    if (!this.sessionAuth.locked) return;
    throw new Error(`${action}: session locked for ${this.session.user}; unlock session to continue`);
  }

  writeSessionStatus() {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/var", "root", system);
    this.ensureSystemDirectory("/var/run", "root", system);
    this.ensureSystemDirectory("/var/run/dindbos", "root", system);
    this.fs.writeOrCreateFile("/var/run/dindbos/session.json", `${JSON.stringify(this.sessionStatus(), null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
  }

  writeSessionCoordinationStatus() {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/var", "root", system);
    this.ensureSystemDirectory("/var/run", "root", system);
    this.ensureSystemDirectory("/var/run/dindbos", "root", system);
    this.ensureSystemDirectory("/proc", "root", system);
    const status = this.sessionCoordinationStatus();
    const payload = `${JSON.stringify(status, null, 2)}\n`;
    this.fs.writeOrCreateFile("/var/run/dindbos/session-lock.json", payload, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/proc/sessions", payload, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
  }

  diskPolicyAreas() {
    return DISK_POLICY_AREAS.map((area) => ({
      ...area,
      bucket: this.storageBucketForArea(area),
      exists: this.fs.exists(area.root),
      usedBytes: this.fs.exists(area.root) ? this.countBytes(area.root) : 0,
    }));
  }

  storageBucketPolicy() {
    const supported = Boolean(globalThis.navigator?.storageBuckets);
    return {
      supported,
      decision: supported ? "available-but-not-mounted" : "fallback-to-current-storage-stack",
      reason: supported
        ? "Storage Buckets are detected, but DindbOS keeps the current OPFS/IndexedDB/Cache split until migration and quota semantics are verified."
        : "Storage Buckets are unavailable in this runtime; /tmp, /var/cache, and durable app data stay separated by disk policy and storage backend selection.",
      areas: DISK_POLICY_AREAS.map((area) => ({
        root: area.root,
        type: area.type,
        bucket: this.storageBucketForArea(area),
      })),
    };
  }

  storageBucketForArea(area) {
    if (area.root === "/tmp") return "session";
    if (area.root === "/var/cache") return "cache";
    if (area.root === "/home" || area.root === "/var" || area.root === "/opt") return "durable";
    return "external-or-virtual";
  }

  compatibilitySnapshot() {
    return compatibilitySnapshot(this);
  }

  syscall(name, args = {}, context = {}) {
    const principal = context.principal || this.permissions.principal({ user: this.session.user, groups: this.session.groups });
    return this.syscalls.call(name, args, { ...context, principal });
  }

  diskPolicyForPath(path) {
    const normalized = this.fs.normalize(path);
    return this.diskPolicyAreas()
      .filter((area) => normalized === area.root || normalized.startsWith(`${area.root}/`))
      .sort((left, right) => right.root.length - left.root.length)
      [0] || {
        root: "/",
        type: "root",
        durability: "persistent",
        policy: "root filesystem",
        exists: true,
        usedBytes: this.countBytes("/"),
      };
  }

  countBytes(path) {
    const node = this.fs.resolve(path) || this.fs.lstat(path);
    if (!node) return 0;
    const resolved = this.fs.resolveNode(node);
    if (resolved.type === "file") return Number(resolved.size || this.fs.readFileBytes(resolved.path).byteLength || 0);
    if (resolved.type !== "directory" && resolved.type !== "mount") return 0;
    return this.fs.list(resolved.path).reduce((total, entry) => total + this.countBytes(entry.path), 0);
  }

  ensureDirectoryPath(path, options = {}) {
    const normalized = this.fs.normalize(path);
    const parts = normalized.split("/").filter(Boolean);
    let cursor = "/";
    parts.forEach((part, index) => {
      cursor = this.fs.join(cursor, part);
      const isLeaf = index === parts.length - 1;
      this.ensureSystemDirectory(cursor, isLeaf ? options.leafOwner : "root", options.principal, {
        group: isLeaf ? options.leafGroup : "root",
        permissions: isLeaf ? options.leafPermissions : "drwxr-xr-x",
      });
    });
  }

  ensureSystemDirectory(path, owner, principal, options = {}) {
    if (this.fs.exists(path)) return;
    this.fs.createDirectory(path, "/", {
      owner,
      group: options.group || "root",
      permissions: options.permissions || "drwxr-xr-x",
    }, principal);
  }

  registerApp(app) {
    this.apps.register(app);
    if (this.shell.refs.dock) this.shell.renderDock();
  }

  unregisterApp(appId) {
    const removed = this.apps.unregister(appId);
    if (removed && this.shell.refs.dock) this.shell.renderDock();
    return removed;
  }

  launch(appId, context = {}) {
    this.assertSessionUnlocked("launch");
    return this.apps.launch(appId, context);
  }

  createSandbox(process) {
    return new AppSandbox(this, process);
  }

  persistFileSystem() {
    this.storage.saveFileSystem(this.fs.snapshot());
  }

  schedulePersistFileSystem(event = {}) {
    this.persistPending = true;
    this.persistenceStats.scheduled += 1;
    this.persistenceStats.lastAction = event.action || "";
    this.persistenceStats.lastPath = event.path || "";
    if (this.persisting) {
      this.persistRequestedDuringFlush = true;
      this.persistenceStats.coalesced += 1;
      return;
    }
    if (this.persistDelayMs <= 0) {
      this.flushPersistentFileSystem();
      return;
    }
    if (this.persistTimer) {
      this.persistenceStats.coalesced += 1;
      return;
    }
    this.persistTimer = globalThis.setTimeout(() => {
      this.persistTimer = null;
      this.flushPersistentFileSystem();
    }, this.persistDelayMs);
  }

  async flushPersistentFileSystem() {
    if (this.persistTimer) {
      globalThis.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.persisting) {
      this.persistRequestedDuringFlush = true;
      await this.storage.flush?.();
      return this.persistenceStatus();
    }
    this.persisting = true;
    const startedAt = Date.now();
    this.persistenceStats.lastFlushStartedAt = new Date(startedAt).toISOString();
    this.persistenceStats.lastFlushError = "";
    this.publishSessionStorageFlush("start");
    let failure = null;
    try {
      do {
        this.persistRequestedDuringFlush = false;
        if (!this.persistPending) {
          await this.storage.flush?.();
          break;
        }
        this.persistPending = false;
        this.persistFileSystem();
        await this.storage.flush?.();
        this.persistenceStats.flushed += 1;
        this.persistenceStats.lastFlushedAt = new Date().toISOString();
        this.persistenceStats.lastFlushDurationMs = Date.now() - startedAt;
      } while (this.persistRequestedDuringFlush || this.persistPending);
    } catch (error) {
      failure = error;
      this.persistenceStats.lastFlushError = error?.message || String(error);
      throw error;
    } finally {
      this.persisting = false;
      this.persistenceStats.lastFlushDurationMs = Date.now() - startedAt;
      this.publishSessionStorageFlush(failure ? "error" : "complete", { error: this.persistenceStats.lastFlushError });
    }
    return this.persistenceStatus();
  }

  resetPersistentFileSystem() {
    if (this.persistTimer) {
      globalThis.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistPending = false;
    this.persistRequestedDuringFlush = false;
    this.storage.resetFileSystem();
  }

  persistenceStatus() {
    return {
      persistDelayMs: this.persistDelayMs,
      persistPending: this.persistPending || Boolean(this.persistTimer),
      persistInFlight: this.persisting,
      persistScheduled: this.persistenceStats.scheduled,
      persistCoalesced: this.persistenceStats.coalesced,
      persistFlushes: this.persistenceStats.flushed,
      persistLastAction: this.persistenceStats.lastAction,
      persistLastPath: this.persistenceStats.lastPath,
      persistLastFlushStartedAt: this.persistenceStats.lastFlushStartedAt,
      persistLastFlushedAt: this.persistenceStats.lastFlushedAt,
      persistLastFlushDurationMs: this.persistenceStats.lastFlushDurationMs,
      persistLastFlushError: this.persistenceStats.lastFlushError,
    };
  }

  hasPendingPersistenceWork() {
    const storageStatus = this.storage.status?.() || {};
    return Boolean(
      this.persistPending
      || this.persistTimer
      || this.persisting
      || storageStatus.writePending
      || storageStatus.persistPending
      || storageStatus.persistInFlight,
    );
  }

  installPersistenceLifecycleHooks() {
    if (this.persistenceHooksInstalled || typeof globalThis.window === "undefined") return;
    this.persistenceHooksInstalled = true;
    const flush = () => {
      this.flushPersistentFileSystem();
    };
    const flushBeforeUnload = (event) => {
      const pending = this.hasPendingPersistenceWork();
      flush();
      if (!pending) return undefined;
      const message = "DindbOS is still saving filesystem changes.";
      event?.preventDefault?.();
      if (event) event.returnValue = message;
      return message;
    };
    globalThis.window.addEventListener("pagehide", flush);
    globalThis.window.addEventListener("beforeunload", flushBeforeUnload);
    globalThis.document?.addEventListener?.("visibilitychange", () => {
      if (globalThis.document.visibilityState === "hidden") flush();
    });
  }

  installServiceLifecycleHooks() {
    if (this.serviceLifecycleHooksInstalled || typeof globalThis.window === "undefined") return;
    this.serviceLifecycleHooksInstalled = true;
    const suspend = (reason) => {
      this.transitionLifecycle("suspending", reason);
      this.services?.suspend?.(reason);
      this.transitionLifecycle("suspended", reason);
      if (reason === "pagehide") this.writeRecoveryRecord(reason);
    };
    const resume = (reason) => {
      this.transitionLifecycle("resuming", reason);
      this.services?.resume?.(reason);
      this.transitionLifecycle("active", reason);
    };
    globalThis.window.addEventListener("pagehide", () => suspend("pagehide"));
    globalThis.window.addEventListener("pageshow", () => resume("pageshow"));
    globalThis.window.addEventListener("beforeunload", () => {
      this.transitionLifecycle("shutting-down", "beforeunload");
      this.writeRecoveryRecord("beforeunload");
    });
    globalThis.document?.addEventListener?.("visibilitychange", () => {
      if (globalThis.document.visibilityState === "hidden") {
        suspend("visibility-hidden");
        return;
      }
      if (globalThis.document.visibilityState === "visible") resume("visibility-visible");
    });
  }

  openPath(path, context = {}) {
    this.assertSessionUnlocked("open");
    const node = this.fs.resolve(path);
    return this.openNode(node, context);
  }

  openNode(node, context = {}) {
    this.assertSessionUnlocked("open");
    if (!node) return null;
    const resolved = this.fs.resolveNode(node);
    if (resolved.type === "directory" || resolved.type === "mount") {
      return this.launch("files", { path: resolved.path });
    }
    if (resolved.type === "app") {
      const principal = this.permissions.principal({ user: this.session.user, groups: this.session.groups });
      this.fs.assertAccess(resolved, "execute", principal, resolved.path || node.path);
      return this.launch(resolved.appId, { node: resolved, ...context });
    }
    return this.apps.openFile(resolved, context);
  }
}

export function normalizeSession(session = {}) {
  const user = sanitizeUserName(session.user || "guest");
  const groups = sanitizeGroups(session.groups);
  const home = normalizeHomePath(session.home, user);
  return {
    ...session,
    user,
    groups,
    home,
  };
}

function sanitizeGroups(groups) {
  const values = Array.isArray(groups) ? groups : ["users"];
  const sanitized = values.map((group) => sanitizeIdentifier(group, "")).filter(Boolean);
  return sanitized.length ? [...new Set(sanitized)] : ["users"];
}

function sanitizeUserName(value) {
  return sanitizeIdentifier(value, "guest");
}

function sanitizeIdentifier(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeHomePath(home, user) {
  if (!home) return `/home/${user}`;
  const normalized = String(home).trim().replace(/\/+/g, "/").replace(/\/$/, "");
  if (!normalized || !normalized.startsWith("/") || normalized.includes("..")) return `/home/${user}`;
  return normalized === "/" ? `/home/${user}` : normalized;
}

function normalizeBrowserProviderUrl(url) {
  const value = String(url || "ws://127.0.0.1:8787/browser").trim();
  if (!value) return "ws://127.0.0.1:8787/browser";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return "ws://127.0.0.1:8787/browser";
    if (!parsed.pathname || parsed.pathname === "/") parsed.pathname = "/browser";
    return parsed.toString();
  } catch {
    return "ws://127.0.0.1:8787/browser";
  }
}

function createRuntimeClipboard(initialText = "") {
  let text = String(initialText || "");
  let updatedAt = "";
  return {
    readText() {
      return text;
    },
    writeText(value = "") {
      text = String(value ?? "");
      updatedAt = new Date().toISOString();
      return { bytes: byteLength(text), updatedAt };
    },
    status() {
      return {
        backend: "runtime",
        bytes: byteLength(text),
        updatedAt,
      };
    },
  };
}

function createRuntimePtyManager() {
  let nextId = 1;
  const sessions = new Map();
  return {
    createSession(options = {}) {
      const now = new Date().toISOString();
      const id = `pty${nextId++}`;
      const session = {
        id,
        name: String(options.name || id),
        columns: boundedInteger(options.columns, 80, 1, 1000),
        rows: boundedInteger(options.rows, 24, 1, 1000),
        input: String(options.input || ""),
        output: String(options.output || ""),
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(id, session);
      return { ...session };
    },
    getSession(id) {
      const session = sessions.get(String(id || ""));
      return session ? { ...session } : null;
    },
    peekInput(id) {
      return sessions.get(String(id || ""))?.input || "";
    },
    writeOutput(id, data = "") {
      const session = sessions.get(String(id || ""));
      if (!session) return { bytes: 0 };
      const text = String(data ?? "");
      session.output += text;
      session.updatedAt = new Date().toISOString();
      return { bytes: byteLength(text), outputBytes: byteLength(session.output) };
    },
    resizeSession(id, size = {}) {
      const session = sessions.get(String(id || ""));
      if (!session) return null;
      session.columns = boundedInteger(size.columns, session.columns, 1, 1000);
      session.rows = boundedInteger(size.rows, session.rows, 1, 1000);
      session.updatedAt = new Date().toISOString();
      return { ...session };
    },
    closeSession(id) {
      return sessions.delete(String(id || ""));
    },
    listSessions() {
      return [...sessions.values()].map((session) => ({ ...session }));
    },
  };
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).byteLength;
}

export { AppRegistry, AppSandbox, DescriptorManager, RuntimeCacheStore, DesktopShell, EventBus, LocalFolderMountManager, NodeCompat, NpmInstaller, PackageManager, PermissionPolicy, PersistentStorage, ProcessManager, SyscallDispatcher, VirtualFileSystem, WasmRunner, WindowManager };
