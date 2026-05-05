import { AppRegistry } from "./app-registry.js?v=20260422-browserd";
import { AppSandbox } from "./app-sandbox.js?v=20260422-browserd";
import { compatibilitySnapshot } from "./compat.js?v=20260422-browserd";
import { DescriptorManager } from "./descriptors.js?v=20260422-browserd";
import { RuntimeCacheStore } from "./cache-store.js?v=20260422-browserd";
import { DesktopShell } from "./desktop-shell.js?v=20260422-browserd";
import { EventBus } from "./event-bus.js?v=20260422-browserd";
import { KeychainManager } from "./keychain.js?v=20260422-browserd";
import { LocalFolderMountManager } from "./local-folder-mount.js?v=20260422-browserd";
import { NetworkBroker } from "./network-broker.js?v=20260422-browserd";
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
const OPERATION_LOCK_PREFIX = "dindbos:operation-lock:";
const REMOTE_SYNC_SNAPSHOT_KEY = "dindbos:remote-sync:last-snapshot";
const REMOTE_SYNC_APPLY_STATUS_PATH = "/var/run/dindbos/remote-sync-apply.json";

export class DindbOS {
  constructor(options = {}) {
    this.root = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
    this.instanceId = String(options.instanceId || `runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    this.session = normalizeSession(options.session || {});
    this.sessionLockTtlMs = Number(options.sessionLockTtlMs || 30_000);
    this.operationLockTtlMs = Number(options.operationLockTtlMs || 30_000);
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
    this.sessionHandoffs = new Map();
    this.sessionHandoffStatus = {
      localOffers: 0,
      peerOffers: 0,
      accepts: 0,
      cancels: 0,
      activeOfferId: "",
      activeMode: "",
      activePeerInstanceId: "",
      lastLocalOfferId: "",
      lastLocalMode: "",
      lastLocalAction: "",
      lastLocalAt: "",
      lastPeerSource: "",
      lastPeerOfferId: "",
      lastPeerMode: "",
      lastPeerAction: "",
      lastPeerAt: "",
      relay: {
        framesSent: 0,
        framesReceived: 0,
        inputsSent: 0,
        inputsReceived: 0,
        lastTransport: "",
        lastFrameOfferId: "",
        lastFrameSource: "",
        lastFrameBytes: 0,
        lastFrameAt: "",
        lastInputOfferId: "",
        lastInputSource: "",
        lastInputType: "",
        lastInputAt: "",
      },
    };
    this.sessionRecovery = {
      recovered: false,
      recoveredAt: "",
      previousInstanceId: "",
      previousRole: "",
      previousLockOwner: "",
      pendingConflicts: 0,
      packageLockOwner: "",
      lastPackageOperation: "",
    };
    this.remoteSync = {
      supported: true,
      backend: "storage-value",
      encrypted: true,
      lastSuccessfulSnapshot: null,
      lastAppliedSnapshot: null,
      lastRepair: null,
      lastApplyRun: null,
      lastRetry: null,
      lastError: "",
    };
    this.ipcEndpoints = new Map();
    this.virtualMounts = new Map();
    this.overlayMounts = new Map();
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
    this.keychain = new KeychainManager(this);
    this.network = new NetworkBroker(this, {
      fetch: options.networkFetch || options.fetch,
      webSocket: options.networkWebSocket,
      rtcPeerConnection: options.networkPeerConnection,
      rawSocketCompanion: options.networkRawSocketCompanion,
    });
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
    if (message.type === "session-handoff") this.recordSessionHandoff(message.source, message.payload, message.at);
    if (message.type === "session-handoff-relay") this.recordSessionHandoffRelay(message.source, message.payload, message.at);
    return message;
  }

  createSessionHandoffOffer(options = {}) {
    const at = new Date().toISOString();
    const ttlMs = Math.max(1_000, Number(options.ttlMs || 5 * 60_000));
    const payload = {
      action: "offer",
      offerId: String(options.offerId || `handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
      mode: normalizeHandoffMode(options.mode),
      targetInstanceId: String(options.targetInstanceId || ""),
      offeredBy: this.instanceId,
      acceptedBy: "",
      user: this.session.user,
      transport: String(options.transport || "broadcast-channel"),
      url: String(options.url || ""),
      status: "offered",
      createdAt: at,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
    const entry = this.recordSessionHandoff(this.instanceId, payload, at);
    this.publishSessionEvent("session-handoff", payload);
    this.writeSessionCoordinationStatus();
    return entry;
  }

  acceptSessionHandoff(offerId, options = {}) {
    const offer = this.sessionHandoffs.get(String(offerId || ""));
    if (!offer || offer.status !== "offered") throw new Error(`session handoff offer not available: ${offerId}`);
    if (offer.targetInstanceId && offer.targetInstanceId !== this.instanceId) {
      throw new Error(`session handoff offer targeted to ${offer.targetInstanceId}`);
    }
    const at = new Date().toISOString();
    const payload = {
      action: "accept",
      offerId: offer.offerId,
      mode: normalizeHandoffMode(options.mode || offer.mode),
      targetInstanceId: offer.offeredBy || offer.source,
      offeredBy: offer.offeredBy || offer.source,
      acceptedBy: this.instanceId,
      user: this.session.user,
      transport: String(options.transport || offer.transport || "broadcast-channel"),
      url: String(options.url || offer.url || ""),
      status: "active",
      createdAt: offer.createdAt || "",
      expiresAt: offer.expiresAt || "",
      acceptedAt: at,
    };
    const entry = this.recordSessionHandoff(this.instanceId, payload, at);
    this.publishSessionEvent("session-handoff", payload);
    this.writeSessionCoordinationStatus();
    return entry;
  }

  cancelSessionHandoff(offerId, reason = "cancelled") {
    const existing = this.sessionHandoffs.get(String(offerId || ""));
    if (!existing) throw new Error(`session handoff offer not available: ${offerId}`);
    const at = new Date().toISOString();
    const payload = {
      action: "cancel",
      offerId: existing.offerId,
      mode: normalizeHandoffMode(existing.mode),
      targetInstanceId: existing.acceptedBy || existing.targetInstanceId || "",
      offeredBy: existing.offeredBy || existing.source || this.instanceId,
      acceptedBy: existing.acceptedBy || "",
      user: this.session.user,
      transport: existing.transport || "broadcast-channel",
      url: existing.url || "",
      status: "cancelled",
      reason: String(reason || "cancelled"),
      createdAt: existing.createdAt || "",
      expiresAt: existing.expiresAt || "",
      cancelledAt: at,
    };
    const entry = this.recordSessionHandoff(this.instanceId, payload, at);
    this.publishSessionEvent("session-handoff", payload);
    this.writeSessionCoordinationStatus();
    return entry;
  }

  recordSessionHandoff(source, payload = {}, at = "") {
    const action = normalizeHandoffAction(payload.action);
    const offerId = String(payload.offerId || "");
    if (!offerId) return null;
    const sourceId = String(source || "unknown");
    const targetInstanceId = String(payload.targetInstanceId || "");
    const acceptedBy = String(payload.acceptedBy || "");
    const offeredBy = String(payload.offeredBy || (action === "offer" ? sourceId : ""));
    if (
      sourceId !== this.instanceId
      && targetInstanceId
      && targetInstanceId !== this.instanceId
      && acceptedBy !== this.instanceId
    ) {
      return null;
    }
    const previous = this.sessionHandoffs.get(offerId) || {};
    const entry = {
      ...previous,
      source: sourceId,
      action,
      offerId,
      mode: normalizeHandoffMode(payload.mode || previous.mode),
      targetInstanceId,
      offeredBy: offeredBy || previous.offeredBy || sourceId,
      acceptedBy: acceptedBy || previous.acceptedBy || "",
      user: String(payload.user || previous.user || ""),
      transport: String(payload.transport || previous.transport || "broadcast-channel"),
      url: String(payload.url || previous.url || ""),
      status: action === "offer" ? "offered" : action === "accept" ? "active" : "cancelled",
      reason: String(payload.reason || previous.reason || ""),
      createdAt: String(payload.createdAt || previous.createdAt || at || ""),
      expiresAt: String(payload.expiresAt || previous.expiresAt || ""),
      acceptedAt: String(payload.acceptedAt || previous.acceptedAt || ""),
      cancelledAt: String(payload.cancelledAt || previous.cancelledAt || ""),
      at: at || new Date().toISOString(),
    };
    this.sessionHandoffs.set(offerId, entry);
    const local = sourceId === this.instanceId;
    if (local) {
      if (action === "offer") this.sessionHandoffStatus.localOffers += 1;
      this.sessionHandoffStatus.lastLocalOfferId = offerId;
      this.sessionHandoffStatus.lastLocalMode = entry.mode;
      this.sessionHandoffStatus.lastLocalAction = action;
      this.sessionHandoffStatus.lastLocalAt = entry.at;
    } else {
      if (action === "offer") this.sessionHandoffStatus.peerOffers += 1;
      this.sessionHandoffStatus.lastPeerSource = sourceId;
      this.sessionHandoffStatus.lastPeerOfferId = offerId;
      this.sessionHandoffStatus.lastPeerMode = entry.mode;
      this.sessionHandoffStatus.lastPeerAction = action;
      this.sessionHandoffStatus.lastPeerAt = entry.at;
    }
    if (action === "accept") {
      this.sessionHandoffStatus.accepts += 1;
      this.sessionHandoffStatus.activeOfferId = offerId;
      this.sessionHandoffStatus.activeMode = entry.mode;
      this.sessionHandoffStatus.activePeerInstanceId = entry.acceptedBy === this.instanceId
        ? entry.offeredBy
        : entry.acceptedBy;
    }
    if (action === "cancel") {
      this.sessionHandoffStatus.cancels += 1;
      if (this.sessionHandoffStatus.activeOfferId === offerId) {
        this.sessionHandoffStatus.activeOfferId = "";
        this.sessionHandoffStatus.activeMode = "";
        this.sessionHandoffStatus.activePeerInstanceId = "";
      }
    }
    this.bus.emit("session:handoff", { ...entry });
    this.writeSessionCoordinationStatus();
    return { ...entry };
  }

  sendSessionHandoffFrame(offerId, frame = {}) {
    const handoff = this.requireActiveSessionHandoff(offerId);
    const at = new Date().toISOString();
    const data = typeof frame.data === "string" ? frame.data : "";
    const payload = {
      kind: "frame",
      offerId: handoff.offerId,
      mode: handoff.mode,
      transport: String(frame.transport || handoff.transport || "broadcast-channel"),
      sequence: boundedInteger(frame.sequence, this.sessionHandoffStatus.relay.framesSent + 1, 1, Number.MAX_SAFE_INTEGER),
      width: boundedInteger(frame.width, 0, 0, 100_000),
      height: boundedInteger(frame.height, 0, 0, 100_000),
      mime: String(frame.mime || "image/jpeg"),
      bytes: boundedInteger(frame.bytes, data ? byteLength(data) : 0, 0, 50_000_000),
      data,
      sentAt: at,
    };
    const entry = this.recordSessionHandoffRelay(this.instanceId, payload, at);
    this.publishSessionEvent("session-handoff-relay", payload);
    this.writeSessionCoordinationStatus();
    return entry;
  }

  sendSessionHandoffInput(offerId, input = {}) {
    const handoff = this.requireActiveSessionHandoff(offerId);
    if (handoff.mode !== "control") throw new Error("session handoff input relay requires control mode");
    const at = new Date().toISOString();
    const payload = {
      kind: "input",
      offerId: handoff.offerId,
      mode: handoff.mode,
      transport: String(input.transport || handoff.transport || "broadcast-channel"),
      sequence: boundedInteger(input.sequence, this.sessionHandoffStatus.relay.inputsSent + 1, 1, Number.MAX_SAFE_INTEGER),
      inputType: normalizeHandoffInputType(input.inputType || input.type),
      x: boundedInteger(input.x, 0, -1_000_000, 1_000_000),
      y: boundedInteger(input.y, 0, -1_000_000, 1_000_000),
      key: String(input.key || ""),
      button: String(input.button || ""),
      deltaX: boundedInteger(input.deltaX, 0, -1_000_000, 1_000_000),
      deltaY: boundedInteger(input.deltaY, 0, -1_000_000, 1_000_000),
      sentAt: at,
    };
    const entry = this.recordSessionHandoffRelay(this.instanceId, payload, at);
    this.publishSessionEvent("session-handoff-relay", payload);
    this.writeSessionCoordinationStatus();
    return entry;
  }

  requireActiveSessionHandoff(offerId) {
    const handoff = this.sessionHandoffs.get(String(offerId || ""));
    if (!handoff || handoff.status !== "active") throw new Error(`session handoff is not active: ${offerId}`);
    return handoff;
  }

  recordSessionHandoffRelay(source, payload = {}, at = "") {
    const sourceId = String(source || "unknown");
    const kind = normalizeHandoffRelayKind(payload.kind);
    const offerId = String(payload.offerId || "");
    const handoff = this.sessionHandoffs.get(offerId);
    if (!handoff || handoff.status !== "active") return null;
    if (kind === "input" && handoff.mode !== "control") return null;
    const entry = {
      source: sourceId,
      kind,
      offerId,
      mode: handoff.mode,
      transport: String(payload.transport || handoff.transport || "broadcast-channel"),
      sequence: boundedInteger(payload.sequence, 0, 0, Number.MAX_SAFE_INTEGER),
      width: boundedInteger(payload.width, 0, 0, 100_000),
      height: boundedInteger(payload.height, 0, 0, 100_000),
      mime: String(payload.mime || ""),
      bytes: boundedInteger(payload.bytes, 0, 0, 50_000_000),
      inputType: normalizeHandoffInputType(payload.inputType || payload.type),
      x: boundedInteger(payload.x, 0, -1_000_000, 1_000_000),
      y: boundedInteger(payload.y, 0, -1_000_000, 1_000_000),
      key: String(payload.key || ""),
      button: String(payload.button || ""),
      deltaX: boundedInteger(payload.deltaX, 0, -1_000_000, 1_000_000),
      deltaY: boundedInteger(payload.deltaY, 0, -1_000_000, 1_000_000),
      at: at || new Date().toISOString(),
    };
    const local = sourceId === this.instanceId;
    const relay = this.sessionHandoffStatus.relay;
    relay.lastTransport = entry.transport;
    if (kind === "frame") {
      if (local) relay.framesSent += 1;
      else relay.framesReceived += 1;
      relay.lastFrameOfferId = offerId;
      relay.lastFrameSource = sourceId;
      relay.lastFrameBytes = entry.bytes;
      relay.lastFrameAt = entry.at;
      this.bus.emit("session:handoff-frame", { ...entry });
    } else {
      if (local) relay.inputsSent += 1;
      else relay.inputsReceived += 1;
      relay.lastInputOfferId = offerId;
      relay.lastInputSource = sourceId;
      relay.lastInputType = entry.inputType;
      relay.lastInputAt = entry.at;
      this.bus.emit("session:handoff-input", { ...entry });
    }
    this.bus.emit("session:handoff-relay", { ...entry });
    this.writeSessionCoordinationStatus();
    return { ...entry };
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
    this.writeMountTableProcfs("disk-policy-roots");
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

  remoteSyncStatus() {
    return {
      ...this.remoteSync,
      mergeRuleCount: this.remoteSyncMergePolicy().rules.length,
      lastSuccessfulSnapshot: this.remoteSync.lastSuccessfulSnapshot
        ? { ...this.remoteSync.lastSuccessfulSnapshot }
        : null,
      lastAppliedSnapshot: this.remoteSync.lastAppliedSnapshot
        ? cloneSyncStatusRecord(this.remoteSync.lastAppliedSnapshot)
        : null,
      lastRepair: this.remoteSync.lastRepair ? { ...this.remoteSync.lastRepair } : null,
      lastApplyRun: this.remoteSync.lastApplyRun ? { ...this.remoteSync.lastApplyRun } : this.readRemoteSyncApplyRun(),
      lastRetry: this.remoteSync.lastRetry ? cloneSyncStatusRecord(this.remoteSync.lastRetry) : null,
    };
  }

  remoteSyncMergePolicy() {
    return {
      version: 1,
      planner: "offline-first",
      rules: [
        {
          root: this.session.home,
          scope: "user-documents",
          policy: "three-way-text-or-conflict-copy",
          reason: "User documents are durable local-first data; text can merge, binary conflicts must preserve both sides.",
        },
        {
          root: "/var/lib/dindbos/app-state",
          scope: "app-state",
          policy: "single-writer-or-app-merge-hook",
          reason: "Structured app state needs app-owned merge semantics when both sides changed.",
        },
        {
          root: "/var/lib/dindbos/packages",
          scope: "package-metadata",
          policy: "transaction-conflict-refusal",
          reason: "Package records must change through package transactions, not sync overwrite.",
        },
        {
          root: "/var/lib/dindbos/search",
          scope: "search-indexes",
          policy: "rebuild-derived-index",
          reason: "Search indexes are derived state and should be rebuilt after sync.",
        },
        {
          root: "/etc/dindbos",
          scope: "settings",
          policy: "last-writer-wins-safe-settings",
          reason: "Safe settings can use timestamp order until stricter per-setting policy exists.",
        },
        {
          root: "/var/cache",
          scope: "cache-metadata",
          policy: "remote-cache-metadata-replace",
          reason: "Cache metadata is evictable and can be replaced without overwriting durable user files.",
        },
      ],
    };
  }

  planRemoteSyncMerge(changes = []) {
    const items = Array.isArray(changes) ? changes : [];
    const planned = items.map((change) => this.planRemoteSyncMergeChange(change));
    return {
      version: 1,
      plannedAt: new Date().toISOString(),
      policyVersion: this.remoteSyncMergePolicy().version,
      total: planned.length,
      summary: planned.reduce((summary, item) => {
        summary[item.action] = Number(summary[item.action] || 0) + 1;
        return summary;
      }, {}),
      changes: planned,
    };
  }

  planRemoteSyncMergeChange(change = {}) {
    const path = this.fs.normalize(String(change.path || "/"), "/");
    const rule = this.remoteSyncRuleForPath(path);
    const base = normalizeMergeValue(change.base);
    const local = normalizeMergeValue(change.local);
    const remote = normalizeMergeValue(change.remote);
    const localChanged = !mergeValuesEqual(base, local);
    const remoteChanged = !mergeValuesEqual(base, remote);
    const mime = String(change.mime || "");
    const textLike = isTextMergeCandidate(path, mime, local, remote, base);
    const baseResult = {
      path,
      scope: rule.scope,
      policy: rule.policy,
      action: "noop",
      winner: "",
      conflictPath: "",
      merged: undefined,
      reason: rule.reason,
    };
    if (rule.scope === "package-metadata") {
      return {
        ...baseResult,
        action: "refuse",
        reason: "Package metadata sync conflicts are refused until a package transaction can validate records, launchers, and trust state.",
      };
    }
    if (rule.scope === "search-indexes") {
      return {
        ...baseResult,
        action: "rebuild",
        winner: "local",
        reason: "Search indexes are derived state; rebuild from synced files instead of merging index records.",
      };
    }
    if (rule.scope === "cache-metadata") {
      return {
        ...baseResult,
        action: remoteChanged ? "use-remote" : "use-local",
        winner: remoteChanged ? "remote" : "local",
        reason: "Cache metadata is evictable and can be replaced by the newest remote snapshot metadata.",
      };
    }
    if (!localChanged && !remoteChanged) return baseResult;
    if (localChanged && !remoteChanged) return { ...baseResult, action: "use-local", winner: "local", reason: "Only the local side changed." };
    if (!localChanged && remoteChanged) return { ...baseResult, action: "use-remote", winner: "remote", reason: "Only the remote side changed." };
    if (mergeValuesEqual(local, remote)) return { ...baseResult, action: "use-local", winner: "both", reason: "Both sides converged on the same value." };
    if (rule.scope === "settings") {
      const winner = newestSide(change.localModified, change.remoteModified);
      return {
        ...baseResult,
        action: "last-writer-wins",
        winner,
        reason: `Settings use timestamp order for first-pass safe-setting merges; ${winner} is newer.`,
      };
    }
    if (rule.scope === "app-state") {
      return {
        ...baseResult,
        action: "conflict-copy",
        winner: "both",
        conflictPath: syncConflictPath(path, change.remoteModified),
        reason: "Both app-state records changed; preserve a conflict copy until the owning app provides a merge hook.",
      };
    }
    if (textLike) {
      const merged = mergeTextValues(base, local, remote);
      if (merged.clean) {
        return {
          ...baseResult,
          action: "three-way-merge",
          winner: "merged",
          merged: merged.value,
          reason: "Text changes appended on both sides and were merged without dropping either side.",
        };
      }
    }
    return {
      ...baseResult,
      action: "conflict-copy",
      winner: "both",
      conflictPath: syncConflictPath(path, change.remoteModified),
      reason: textLike
        ? "Text edits overlap; preserve both versions as a conflict copy."
        : "Binary or structured document changed on both sides; preserve both versions as a conflict copy.",
    };
  }

  remoteSyncRuleForPath(path) {
    const normalized = this.fs.normalize(path, "/");
    return this.remoteSyncMergePolicy().rules
      .filter((rule) => normalized === rule.root || normalized.startsWith(`${rule.root}/`))
      .sort((left, right) => right.root.length - left.root.length)
      [0] || {
        root: "/",
        scope: "unknown",
        policy: "conflict-copy",
        reason: "Unknown sync roots preserve both sides until an explicit policy is defined.",
      };
  }

  async applyRemoteSyncSnapshot(options = {}) {
    const passphrase = String(options.passphrase || "");
    if (!passphrase) throw new Error("remote sync apply requires a passphrase");
    const snapshot = this.normalizeRemoteSyncSnapshotInput(options.snapshot);
    if (!snapshot?.ciphertext) throw new Error("remote sync apply requires an encrypted snapshot");
    const appliedAt = new Date().toISOString();
    const dryRun = Boolean(options.dryRun);
    const startIndex = Math.max(0, Math.trunc(Number(options.startIndex || 0)));
    const maxFiles = Number.isFinite(Number(options.maxFiles)) ? Math.max(0, Math.trunc(Number(options.maxFiles))) : Infinity;
    try {
      const payload = await decryptRemoteSyncPayload(snapshot, passphrase);
      const files = Array.isArray(payload.files) ? payload.files : [];
      const result = {
        id: snapshot.id || payload.id || "",
        createdAt: snapshot.createdAt || payload.createdAt || "",
        appliedAt,
        dryRun,
        status: "complete",
        resumeOf: String(options.resumeOf || ""),
        startIndex,
        nextIndex: startIndex,
        fileCount: files.length,
        summary: {},
        changes: [],
        refusedRecords: [],
      };
      this.recordRemoteSyncApplyRun({
        snapshotId: result.id,
        createdAt: result.createdAt,
        status: dryRun ? "dry-run" : "running",
        startedAt: appliedAt,
        updatedAt: appliedAt,
        startIndex,
        nextIndex: startIndex,
        totalFiles: files.length,
        dryRun,
      });
      let appliedFiles = 0;
      for (let index = startIndex; index < files.length; index += 1) {
        if (appliedFiles >= maxFiles) {
          result.status = "interrupted";
          break;
        }
        const file = files[index];
        const planned = this.planRemoteSyncApplyFile(file, options);
        result.summary[planned.action] = Number(result.summary[planned.action] || 0) + 1;
        if (planned.action === "refuse") {
          result.refusedRecords.push(remoteSyncRefusalRecord(planned, index));
        }
        if (!dryRun) this.executeRemoteSyncApplyPlan(planned);
        result.changes.push(planned);
        appliedFiles += 1;
        result.nextIndex = index + 1;
        this.recordRemoteSyncApplyRun({
          snapshotId: result.id,
          createdAt: result.createdAt,
          status: dryRun ? "dry-run" : "running",
          startedAt: appliedAt,
          updatedAt: new Date().toISOString(),
          startIndex,
          nextIndex: result.nextIndex,
          totalFiles: files.length,
          dryRun,
        });
      }
      this.remoteSync.lastAppliedSnapshot = {
        id: result.id,
        createdAt: result.createdAt,
        appliedAt,
        dryRun,
        status: result.status,
        startIndex: result.startIndex,
        nextIndex: result.nextIndex,
        fileCount: result.fileCount,
        summary: { ...result.summary },
        conflicts: Number(result.summary["conflict-copy"] || 0),
        refused: Number(result.summary.refuse || 0),
        refusedRecords: result.refusedRecords.map((record) => ({ ...record })),
      };
      this.recordRemoteSyncApplyRun({
        snapshotId: result.id,
        createdAt: result.createdAt,
        status: result.status,
        startedAt: appliedAt,
        updatedAt: new Date().toISOString(),
        startIndex,
        nextIndex: result.nextIndex,
        totalFiles: files.length,
        dryRun,
        summary: { ...result.summary },
      });
      this.remoteSync.lastError = "";
      this.bus.emit("sync:apply", this.remoteSyncStatus());
      return result;
    } catch (error) {
      this.remoteSync.lastError = error?.message || String(error);
      throw error;
    }
  }

  listRemoteSyncRefusals() {
    const records = this.remoteSync.lastAppliedSnapshot?.refusedRecords;
    return Array.isArray(records) ? records.map((record) => ({ ...record })) : [];
  }

  async retryRemoteSyncRefusals(options = {}) {
    const passphrase = String(options.passphrase || "");
    if (!passphrase) throw new Error("remote sync retry requires a passphrase");
    const snapshot = this.normalizeRemoteSyncSnapshotInput(options.snapshot);
    if (!snapshot?.ciphertext) throw new Error("remote sync retry requires the original encrypted snapshot");
    const startedAt = new Date().toISOString();
    const refused = this.listRemoteSyncRefusals();
    const refusedPaths = new Set(refused.map((record) => record.path));
    const result = {
      id: snapshot.id || "",
      startedAt,
      status: "complete",
      applied: 0,
      refused: 0,
      records: [],
    };
    try {
      const payload = await decryptRemoteSyncPayload(snapshot, passphrase);
      const files = (Array.isArray(payload.files) ? payload.files : [])
        .filter((file) => {
          const path = this.fs.normalize(String(file.path || "/"), "/");
          return refusedPaths.has(path);
        });
      files.forEach((file, index) => {
        const path = this.fs.normalize(String(file.path || "/"), "/");
        try {
          const packageRecord = this.validateRemoteSyncPackageRecord(path, file);
          this.withRuntimeOperationLock("package-db", {
            operation: "sync-retry",
            packageId: packageRecord.record.id,
          }, () => {
            this.writeRemoteSyncApplyFile(path, packageRecord.bytes, file.mime || "application/json");
            if (packageRecord.record?.app && this.fs.exists(packageRecord.record.installPath || `/opt/${packageRecord.record.id}`)) {
              this.packages.registerPackageApp(packageRecord.record);
            }
          });
          result.applied += 1;
          result.records.push({
            path,
            action: "applied",
            scope: "package-metadata",
            packageId: packageRecord.record.id,
            version: packageRecord.record.version,
            index,
          });
        } catch (error) {
          result.refused += 1;
          result.records.push({
            path,
            action: "refused",
            scope: "package-metadata",
            reason: error?.message || String(error),
            index,
          });
        }
      });
      this.remoteSync.lastRetry = {
        id: result.id,
        retriedAt: startedAt,
        status: result.status,
        applied: result.applied,
        refused: result.refused,
        records: result.records.map((record) => ({ ...record })),
      };
      this.remoteSync.lastError = "";
      this.bus.emit("sync:retry", this.remoteSyncStatus());
      return result;
    } catch (error) {
      this.remoteSync.lastError = error?.message || String(error);
      throw error;
    }
  }

  validateRemoteSyncPackageRecord(path, file = {}) {
    const normalized = this.fs.normalize(path, "/");
    if (!normalized.startsWith("/var/lib/dindbos/packages/") || !normalized.endsWith(".json")) {
      throw new Error("remote sync retry only accepts package metadata records");
    }
    const bytes = base64ToBytes(file.content || "");
    let record;
    try {
      record = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("package metadata record is not valid JSON");
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("package metadata record must be a JSON object");
    const id = String(record.id || "");
    const version = String(record.version || "");
    if (!isSafePackageRecordId(id)) throw new Error("package metadata record has an invalid package id");
    if (!version.trim()) throw new Error("package metadata record has no version");
    const expectedPath = `/var/lib/dindbos/packages/${id}.json`;
    if (normalized !== expectedPath) throw new Error(`package metadata path mismatch: expected ${expectedPath}`);
    if (record.installPath && this.fs.normalize(record.installPath, "/") !== `/opt/${id}`) {
      throw new Error("package metadata installPath must stay inside its package root");
    }
    if (record.app?.id && !isSafePackageRecordId(String(record.app.id))) {
      throw new Error("package metadata app id is invalid");
    }
    return { record, bytes };
  }

  async resumeRemoteSyncApply(options = {}) {
    const run = this.remoteSync.lastApplyRun || this.readRemoteSyncApplyRun();
    if (!run || run.status !== "interrupted") throw new Error("remote sync apply has no interrupted run to resume");
    const snapshot = this.normalizeRemoteSyncSnapshotInput(options.snapshot);
    if (!snapshot?.ciphertext) throw new Error("remote sync resume requires the original encrypted snapshot");
    return this.applyRemoteSyncSnapshot({
      ...options,
      snapshot,
      startIndex: Number(run.nextIndex || 0),
      resumeOf: run.snapshotId || "",
    });
  }

  recordRemoteSyncApplyRun(run = {}) {
    const status = {
      snapshotId: String(run.snapshotId || ""),
      createdAt: String(run.createdAt || ""),
      status: String(run.status || "unknown"),
      startedAt: String(run.startedAt || ""),
      updatedAt: String(run.updatedAt || new Date().toISOString()),
      startIndex: Number(run.startIndex || 0),
      nextIndex: Number(run.nextIndex || 0),
      totalFiles: Number(run.totalFiles || 0),
      dryRun: Boolean(run.dryRun),
      summary: run.summary && typeof run.summary === "object" ? { ...run.summary } : {},
    };
    this.remoteSync.lastApplyRun = status;
    const system = this.permissions.systemPrincipal();
    this.ensureDirectoryPath(this.fs.dirname(REMOTE_SYNC_APPLY_STATUS_PATH), { principal: system });
    this.fs.writeOrCreateFile(REMOTE_SYNC_APPLY_STATUS_PATH, `${JSON.stringify(status, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    return { ...status };
  }

  readRemoteSyncApplyRun() {
    if (!this.fs?.exists?.(REMOTE_SYNC_APPLY_STATUS_PATH)) return null;
    try {
      return JSON.parse(this.fs.readFile(REMOTE_SYNC_APPLY_STATUS_PATH, "/", this.permissions.systemPrincipal()));
    } catch {
      return null;
    }
  }

  normalizeRemoteSyncSnapshotInput(snapshot = null) {
    const value = snapshot || this.storage.readValueSync?.(REMOTE_SYNC_SNAPSHOT_KEY) || null;
    if (!value) return null;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value && typeof value === "object" ? value : null;
  }

  planRemoteSyncApplyFile(file = {}, options = {}) {
    const path = this.fs.normalize(String(file.path || "/"), "/");
    const mime = String(file.mime || "application/octet-stream");
    const remoteBytes = base64ToBytes(file.content || "");
    const localExists = this.fs.exists(path);
    const localNode = localExists ? this.fs.stat(path) : null;
    const localBytes = localExists && localNode?.type === "file" ? this.fs.readFileBytes(path) : new Uint8Array();
    const rule = this.remoteSyncRuleForPath(path);
    const baseFiles = options.baseFiles && typeof options.baseFiles === "object" ? options.baseFiles : {};
    const baseValue = Object.prototype.hasOwnProperty.call(baseFiles, path) ? baseFiles[path] : undefined;
    let planned;
    if (rule.scope === "package-metadata" || rule.scope === "search-indexes" || rule.scope === "cache-metadata" || rule.scope === "settings") {
      planned = this.planRemoteSyncMergeChange({
        path,
        mime,
        base: baseValue,
        local: localExists ? mergeValueFromBytes(path, mime, localBytes) : null,
        remote: mergeValueFromBytes(path, mime, remoteBytes),
        localModified: localNode?.modified || "",
        remoteModified: file.modified || "",
      });
    } else if (!localExists) {
      planned = {
        path,
        scope: rule.scope,
        policy: rule.policy,
        action: "use-remote",
        winner: "remote",
        conflictPath: "",
        reason: "Local file is missing; restore the remote snapshot file.",
      };
    } else if (bytesEqual(localBytes, remoteBytes)) {
      planned = {
        path,
        scope: rule.scope,
        policy: rule.policy,
        action: "noop",
        winner: "both",
        conflictPath: "",
        reason: "Local file already matches the remote snapshot file.",
      };
    } else if (baseValue === undefined && (rule.scope === "user-documents" || rule.scope === "app-state")) {
      planned = {
        path,
        scope: rule.scope,
        policy: rule.policy,
        action: "conflict-copy",
        winner: "both",
        conflictPath: syncConflictPath(path, file.modified),
        reason: "No common base is available; preserve the remote version as a conflict copy.",
      };
    } else {
      planned = this.planRemoteSyncMergeChange({
        path,
        mime,
        base: baseValue,
        local: mergeValueFromBytes(path, mime, localBytes),
        remote: mergeValueFromBytes(path, mime, remoteBytes),
        localModified: localNode?.modified || "",
        remoteModified: file.modified || "",
      });
    }
    return {
      ...planned,
      mime,
      bytes: remoteBytes.byteLength,
      remoteBytes,
    };
  }

  executeRemoteSyncApplyPlan(plan) {
    if (["use-remote"].includes(plan.action) || (plan.action === "last-writer-wins" && plan.winner === "remote")) {
      this.writeRemoteSyncApplyFile(plan.path, plan.remoteBytes, plan.mime);
      return;
    }
    if (plan.action === "three-way-merge") {
      this.ensureDirectoryPath(this.fs.dirname(plan.path), { principal: this.permissions.systemPrincipal() });
      this.fs.writeOrCreateFile(plan.path, plan.merged || "", "/", { mime: plan.mime || "text/plain" }, this.permissions.systemPrincipal());
      return;
    }
    if (plan.action === "conflict-copy" && plan.conflictPath) {
      this.writeRemoteSyncApplyFile(plan.conflictPath, plan.remoteBytes, plan.mime);
    }
  }

  writeRemoteSyncApplyFile(path, bytes, mime) {
    this.ensureDirectoryPath(this.fs.dirname(path), { principal: this.permissions.systemPrincipal() });
    this.fs.writeOrCreateFileBytes(path, bytes, "/", { mime }, this.permissions.systemPrincipal());
  }

  listRemoteSyncConflicts(root = "/") {
    const start = this.fs.normalize(root || "/", "/");
    const conflicts = [];
    const system = this.permissions.systemPrincipal();
    const visit = (path) => {
      const node = this.fs.resolve(path);
      if (!node || node.type !== "directory") return;
      if (this.fs.basename(path) === ".sync-conflicts") {
        this.fs.list(path, "/", system)
          .filter((entry) => entry.type === "file")
          .forEach((entry) => {
            conflicts.push({
              path: entry.path,
              targetPath: targetPathFromSyncConflict(entry.path, this.fs),
              bytes: Number(entry.size || 0),
              modified: entry.modified || "",
              status: "pending",
            });
          });
        return;
      }
      this.fs.list(path, "/", system)
        .filter((entry) => entry.type === "directory")
        .forEach((entry) => visit(entry.path));
    };
    visit(start);
    return conflicts.sort((left, right) => left.path.localeCompare(right.path));
  }

  resolveRemoteSyncConflict(conflictPath, options = {}) {
    const normalized = this.fs.normalize(conflictPath || "", "/");
    const action = normalizeSyncConflictAction(options.action || "use-conflict");
    const conflict = this.listRemoteSyncConflicts().find((entry) => entry.path === normalized);
    if (!conflict) throw new Error(`remote sync conflict not found: ${conflictPath}`);
    const system = this.permissions.systemPrincipal();
    if (action === "use-conflict") {
      const node = this.fs.stat(conflict.path, "/", system);
      const bytes = this.fs.readFileBytes(conflict.path, "/", system);
      this.writeRemoteSyncApplyFile(conflict.targetPath, bytes, node.mime || "application/octet-stream");
    }
    this.fs.remove(conflict.path, "/", {}, system);
    const repair = {
      path: conflict.path,
      targetPath: conflict.targetPath,
      action,
      resolvedAt: new Date().toISOString(),
      remainingConflicts: this.listRemoteSyncConflicts().length,
    };
    this.remoteSync.lastRepair = { ...repair };
    this.bus.emit("sync:repair", repair);
    return repair;
  }

  async createRemoteSyncSnapshot(options = {}) {
    const passphrase = String(options.passphrase || "");
    if (!passphrase) throw new Error("remote sync snapshot requires a passphrase");
    const createdAt = new Date().toISOString();
    const paths = Array.isArray(options.paths) && options.paths.length
      ? options.paths.map((path) => this.fs.normalize(path, "/"))
      : [this.session.home, "/var/lib/dindbos/app-state", "/var/lib/dindbos/packages", "/var/cache", "/etc/dindbos"];
    const payload = this.collectRemoteSyncPayload(paths, createdAt);
    const encrypted = await encryptRemoteSyncPayload(payload, passphrase);
    const snapshot = {
      id: `sync-${Date.now().toString(36)}`,
      version: 1,
      createdAt,
      backend: "storage-value",
      encrypted: true,
      algorithm: encrypted.algorithm,
      instanceId: this.instanceId,
      user: this.session.user,
      paths,
      fileCount: payload.files.length,
      bytes: byteLength(JSON.stringify(payload)),
      packageRecords: payload.files.filter((file) => file.path.startsWith("/var/lib/dindbos/packages/")).length,
      appStateRecords: payload.files.filter((file) => file.path.startsWith("/var/lib/dindbos/app-state/")).length,
      cacheRecords: payload.files.filter((file) => file.path.startsWith("/var/cache/")).length,
      settingsRecords: payload.files.filter((file) => file.path.startsWith("/etc/dindbos/")).length,
      salt: encrypted.salt,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
    };
    this.storage.writeValue?.(REMOTE_SYNC_SNAPSHOT_KEY, JSON.stringify(snapshot));
    this.remoteSync.lastSuccessfulSnapshot = snapshotSummary(snapshot);
    this.remoteSync.lastError = "";
    this.bus.emit("sync:snapshot", this.remoteSyncStatus());
    return { ...snapshot };
  }

  collectRemoteSyncPayload(paths, createdAt = new Date().toISOString()) {
    const system = this.permissions.systemPrincipal();
    const files = [];
    const visit = (path) => {
      const normalized = this.fs.normalize(path, "/");
      const node = this.fs.resolve(normalized);
      if (!node) return;
      if (node.type === "file") {
        const bytes = this.fs.readFileBytes(normalized, "/", system);
        files.push({
          path: normalized,
          mime: node.mime || "application/octet-stream",
          modified: node.modified || "",
          bytes: bytes.length,
          content: bytesToBase64(bytes),
        });
        return;
      }
      if (node.type === "directory" || node.type === "mount") {
        (node.children || []).forEach((child) => visit(this.fs.join(normalized, child.name)));
      }
    };
    paths.forEach((path) => visit(path));
    return {
      version: 1,
      createdAt,
      instanceId: this.instanceId,
      user: this.session.user,
      paths,
      files: files.sort((left, right) => left.path.localeCompare(right.path)),
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
    const sessionRecovery = this.sessionRecoveryFromShutdown(record, recoveredAt);
    const recovery = {
      recoveredAt,
      reason: "dirty-shutdown",
      previousShutdown: record,
      sessionRecovery,
      action: "recorded browser-interrupted shutdown for user-visible diagnostics",
    };
    this.sessionRecovery = sessionRecovery;
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
    this.writeSessionCoordinationStatus();
    return recovery;
  }

  sessionRecoveryFromShutdown(record, recoveredAt = new Date().toISOString()) {
    const session = record.session || {};
    const packageLock = record.operationLocks?.packageDb || null;
    return {
      recovered: true,
      recoveredAt,
      previousInstanceId: String(session.instanceId || ""),
      previousRole: String(session.role || "unknown"),
      previousLockOwner: String(session.lockOwner || ""),
      pendingConflicts: Number(session.conflicts?.pending || 0),
      packageLockOwner: String(packageLock?.owner || ""),
      lastPackageOperation: String(session.packageOperation?.lastLocalOperation || session.packageOperation?.lastPeerOperation || ""),
    };
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
      session: this.sessionCoordinationStatus(),
      operationLocks: {
        packageDb: this.readRuntimeOperationLock("package-db"),
      },
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
    ["/proc", "/dev"].forEach((root) => this.ensureSystemDirectory(root, "root", system));
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
      handoff: {
        ...this.sessionHandoffStatus,
        relay: { ...this.sessionHandoffStatus.relay },
        offers: [...this.sessionHandoffs.values()].slice(-10).map((entry) => ({ ...entry })),
      },
      recovery: { ...this.sessionRecovery },
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

  withRuntimeOperationLock(name, details = {}, callback = () => null) {
    const lock = this.acquireRuntimeOperationLock(name, details);
    let result;
    try {
      result = callback(lock);
    } catch (error) {
      this.releaseRuntimeOperationLock(name, lock);
      throw error;
    }
    if (result && typeof result.then === "function") {
      return result.finally(() => this.releaseRuntimeOperationLock(name, lock));
    }
    this.releaseRuntimeOperationLock(name, lock);
    return result;
  }

  acquireRuntimeOperationLock(name, details = {}, now = Date.now()) {
    const key = this.operationLockKey(name);
    const existing = this.readRuntimeOperationLock(name);
    const expired = existing?.expiresAtMs && Number(existing.expiresAtMs) <= now;
    if (existing && !expired && existing.owner !== this.instanceId) {
      throw new Error(`${name}: operation locked by ${existing.owner}`);
    }
    const record = {
      name,
      owner: this.instanceId,
      operation: String(details.operation || ""),
      packageId: String(details.packageId || ""),
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.operationLockTtlMs).toISOString(),
      expiresAtMs: now + this.operationLockTtlMs,
    };
    this.writeRuntimeOperationLock(key, record);
    return record;
  }

  releaseRuntimeOperationLock(name, record = null) {
    const key = this.operationLockKey(name);
    const existing = this.readRuntimeOperationLock(name);
    if (existing && record && existing.owner !== record.owner) return false;
    this.removeRuntimeOperationLock(key);
    return true;
  }

  readRuntimeOperationLock(name) {
    const key = this.operationLockKey(name);
    const raw = this.storage.readValueSync?.(key) ?? globalThis.localStorage?.getItem?.(key) ?? null;
    if (!raw) return null;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  writeRuntimeOperationLock(key, record) {
    const payload = JSON.stringify(record);
    this.storage.writeValue?.(key, payload);
    try {
      globalThis.localStorage?.setItem?.(key, payload);
    } catch {}
  }

  removeRuntimeOperationLock(key) {
    this.storage.removeValue?.(key);
    try {
      globalThis.localStorage?.removeItem?.(key);
    } catch {}
  }

  operationLockKey(name) {
    return `${OPERATION_LOCK_PREFIX}${String(name || "runtime")}`;
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

  mountTable() {
    const roots = [
      {
        id: "rootfs",
        root: "/",
        driver: "rootfs",
        readonly: false,
        owner: "root",
        durability: "persistent",
        quotaPolicy: "browser-storage",
        capabilities: [],
        source: "runtime",
        usedBytes: this.countBytes("/"),
        support: "browser-vfs",
      },
      ...this.diskPolicyAreas().map((area) => ({
        id: `disk:${area.root}`,
        root: area.root,
        driver: mountDriverForDiskArea(area),
        readonly: false,
        owner: "root",
        durability: area.durability,
        quotaPolicy: area.bucket || this.storageBucketForArea(area),
        capabilities: area.root === "/mnt" ? ["localMount.manage"] : [],
        source: "disk-policy",
        usedBytes: area.usedBytes,
        support: this.storageBucketPolicy().decision,
      })),
      {
        id: "procfs",
        root: "/proc",
        driver: "procfs",
        readonly: true,
        owner: "root",
        durability: "runtime",
        quotaPolicy: "generated",
        capabilities: [],
        source: "runtime",
        usedBytes: this.countBytes("/proc"),
        support: "generated",
      },
      {
        id: "devfs",
        root: "/dev",
        driver: "devfs",
        readonly: false,
        owner: "root",
        durability: "runtime",
        quotaPolicy: "generated",
        capabilities: [],
        source: "runtime",
        usedBytes: this.countBytes("/dev"),
        support: "generated",
      },
    ];
    const localMounts = this.localMounts?.listMounts?.() || [];
    const packageMounts = this.packages?.packageImageMounts?.() || [];
    packageMounts.forEach((mount) => roots.push({ ...mount }));
    [...this.overlayMounts.values()].forEach((mount) => roots.push({
      ...mount,
      usedBytes: this.countBytes(mount.root),
      support: "browser-vfs-snapshot",
    }));
    [...this.virtualMounts.values()].forEach((mount) => roots.push({
      ...mount,
      usedBytes: this.countBytes(mount.root),
      support: "browser-vfs",
    }));
    localMounts.forEach((mount) => {
      roots.push({
        id: `local:${mount.path}`,
        root: mount.path,
        driver: "localfs",
        readonly: mount.mode === "read",
        owner: this.session.user || "guest",
        durability: "user-granted",
        quotaPolicy: "host-filesystem",
        capabilities: ["localMount.read", "localMount.manage"],
        source: mount.handleName || mount.name || "local-folder",
        usedBytes: 0,
        support: "file-system-access-api",
      });
    });
    return roots
      .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.root === entry.root && candidate.driver === entry.driver) === index)
      .sort((left, right) => left.root.localeCompare(right.root));
  }

  mountVirtual(path, options = {}, principal = this.permissions.systemPrincipal()) {
    const root = this.fs.normalize(path || "");
    if (!root || root === "/") throw new Error("mount: path is required");
    const driver = normalizeVirtualMountDriver(options.driver || options.type || "memfs");
    if (driver === "overlayfs") return this.mountOverlay(root, options, principal);
    if (driver === "zipfs") return this.mountZip(root, options, principal);
    if (this.virtualMounts.has(root)) throw new Error(`mount: ${root}: already mounted`);
    const readonly = Boolean(options.readonly);
    const system = this.permissions.systemPrincipal();
    this.fs.createMount(root, {
      mountType: driver,
      handleName: options.source || driver,
      permissions: readonly ? "dr-xr-xr-x" : "drwxrwxrwx",
      owner: principal.user || this.session.user || "guest",
      group: principal.groups?.[0] || "users",
    }, system);
    const record = {
      id: `virtual:${root}`,
      root,
      driver,
      readonly,
      owner: principal.user || this.session.user || "guest",
      durability: "runtime",
      quotaPolicy: "memory",
      capabilities: ["mount.manage"],
      source: options.source || "syscall",
    };
    this.virtualMounts.set(root, record);
    this.writeMountTableProcfs("virtual-mount");
    return { ...record };
  }

  mountZip(path, options = {}, principal = this.permissions.systemPrincipal()) {
    const root = this.fs.normalize(path || "");
    const archive = this.fs.normalize(options.archive || options.sourcePath || "");
    if (!archive) throw codedError("EINVAL", "mount: zipfs requires archive path");
    if (this.overlayMounts.has(root) || this.virtualMounts.has(root)) throw codedError("EBUSY", `mount: ${root}: already mounted`);
    const system = this.permissions.systemPrincipal();
    const entries = parseStoredZipEntries(this.fs.readFileBytes(archive, "/", system));
    this.fs.createMount(root, {
      mountType: "zipfs",
      handleName: archive,
      permissions: "dr-xr-xr-x",
      owner: principal.user || this.session.user || "guest",
      group: principal.groups?.[0] || "users",
    }, system);
    entries.forEach((entry) => materializeZipEntry(this.fs, root, entry, system));
    const record = {
      id: `zip:${root}`,
      root,
      driver: "zipfs",
      readonly: true,
      owner: principal.user || this.session.user || "guest",
      durability: "runtime",
      quotaPolicy: "archive",
      capabilities: ["mount.manage"],
      source: archive,
      entries: entries.length,
    };
    this.virtualMounts.set(root, record);
    this.writeMountTableProcfs("zip-mount");
    return { ...record };
  }

  unmountVirtual(path, principal = this.permissions.systemPrincipal()) {
    const root = this.fs.normalize(path || "");
    if (this.overlayMounts.has(root)) return this.unmountOverlay(root, principal);
    const record = this.virtualMounts.get(root);
    if (!record) throw new Error(`umount: ${root}: not a virtual mount`);
    if (this.fs.exists(root)) this.fs.remove(root, "/", { recursive: true }, this.permissions.systemPrincipal());
    this.virtualMounts.delete(root);
    this.writeMountTableProcfs("virtual-unmount");
    return { ...record };
  }

  mountOverlay(path, options = {}, principal = this.permissions.systemPrincipal()) {
    const root = this.fs.normalize(path || "");
    const lower = this.fs.normalize(options.lower || "");
    const upper = this.fs.normalize(options.upper || "");
    if (!lower || !upper) throw codedError("EINVAL", "mount: overlayfs requires lower and upper paths");
    if (this.overlayMounts.has(root) || this.virtualMounts.has(root)) throw codedError("EBUSY", `mount: ${root}: already mounted`);
    assertDirectoryLike(this.fs, lower, "lower");
    assertDirectoryLike(this.fs, upper, "upper");
    const system = this.permissions.systemPrincipal();
    this.fs.createMount(root, {
      mountType: "overlayfs",
      handleName: `${upper} over ${lower}`,
      permissions: "dr-xr-xr-x",
      owner: principal.user || this.session.user || "guest",
      group: principal.groups?.[0] || "users",
    }, system);
    materializeOverlayTree(this.fs, lower, root, system);
    materializeOverlayTree(this.fs, upper, root, system);
    const record = {
      id: `overlay:${root}`,
      root,
      driver: "overlayfs",
      readonly: true,
      owner: principal.user || this.session.user || "guest",
      durability: "runtime",
      quotaPolicy: "memory",
      capabilities: ["mount.manage"],
      source: options.source || "syscall",
      lower,
      upper,
      precedence: "upper",
    };
    this.overlayMounts.set(root, record);
    this.writeMountTableProcfs("overlay-mount");
    return { ...record };
  }

  unmountOverlay(path, principal = this.permissions.systemPrincipal()) {
    const root = this.fs.normalize(path || "");
    const record = this.overlayMounts.get(root);
    if (!record) throw new Error(`umount: ${root}: not an overlay mount`);
    if (this.fs.exists(root)) this.fs.remove(root, "/", { recursive: true }, this.permissions.systemPrincipal());
    this.overlayMounts.delete(root);
    this.writeMountTableProcfs("overlay-unmount");
    return { ...record };
  }

  mountLines() {
    return this.mountTable().map((entry) => formatMountTableLine(entry));
  }

  writeMountTableProcfs(reason = "mount-table") {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/proc", "root", system);
    const table = this.mountTable();
    const status = {
      service: "dindbos-mount-table",
      reason: String(reason || "mount-table"),
      count: table.length,
      mounts: table,
      updatedAt: new Date().toISOString(),
    };
    this.fs.writeOrCreateFile("/proc/mounts", `${table.map((entry) => formatMountTableLine(entry)).join("\n")}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "text/plain",
    }, system);
    this.fs.writeOrCreateFile("/proc/mounts.json", `${JSON.stringify(status, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "application/json",
    }, system);
    return status;
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

  registerIpcEndpoint(process, endpoint, handler) {
    const id = normalizeIpcEndpoint(endpoint);
    if (typeof handler !== "function") throw new Error(`ipc: ${id}: handler is required`);
    assertIpcEndpointAllowed(process, id, "register");
    const namespace = process?.manifest?.namespace || {};
    const record = {
      endpoint: id,
      ownerPid: process?.pid || 0,
      ownerAppId: process?.appId || "",
      ownerNamespace: namespace.processGroup || "",
      ownerPackageId: namespace.packageId || "",
      handler,
      createdAt: new Date().toISOString(),
    };
    this.ipcEndpoints.set(id, record);
    this.bus.emit("ipc:endpoint", {
      action: "register",
      endpoint: id,
      ownerPid: record.ownerPid,
      ownerAppId: record.ownerAppId,
      ownerNamespace: record.ownerNamespace,
      ownerPackageId: record.ownerPackageId,
    });
    return publicIpcEndpoint(record);
  }

  sendIpcMessage(process, endpoint, payload = {}) {
    const id = normalizeIpcEndpoint(endpoint);
    const record = this.ipcEndpoints.get(id);
    if (!record) throw new Error(`ipc: ${id}: no such endpoint`);
    assertIpcSendAllowed(process, record);
    const message = {
      endpoint: id,
      fromPid: process?.pid || 0,
      fromAppId: process?.appId || "",
      fromNamespace: process?.manifest?.namespace?.processGroup || "",
      toPid: record.ownerPid,
      toAppId: record.ownerAppId,
      toNamespace: record.ownerNamespace,
      payload: cloneJson(payload),
      sentAt: new Date().toISOString(),
    };
    this.bus.emit("ipc:message", { ...message, payload: cloneJson(message.payload) });
    return cloneJson(record.handler(message));
  }

  listIpcEndpoints(process = null) {
    return [...this.ipcEndpoints.values()]
      .filter((record) => !process || canSeeIpcEndpoint(process, record))
      .map(publicIpcEndpoint);
  }

  unregisterIpcEndpointsForPid(pid, reason = "process-exit") {
    const ownerPid = Number(pid || 0);
    const removed = [];
    [...this.ipcEndpoints.entries()].forEach(([endpoint, record]) => {
      if (Number(record.ownerPid || 0) !== ownerPid) return;
      this.ipcEndpoints.delete(endpoint);
      removed.push(publicIpcEndpoint(record));
    });
    if (removed.length) this.bus.emit("ipc:endpoint", { action: "unregister", reason, ownerPid, endpoints: removed });
    return removed;
  }

  unregisterIpcEndpointsForNamespace(namespace = {}, reason = "namespace-cleanup") {
    const processGroup = String(namespace.processGroup || "").trim();
    const packageId = String(namespace.packageId || "").trim();
    const removed = [];
    [...this.ipcEndpoints.entries()].forEach(([endpoint, record]) => {
      const sameProcessGroup = processGroup && record.ownerNamespace === processGroup;
      const samePackage = packageId && record.ownerPackageId === packageId;
      if (!sameProcessGroup && !samePackage) return;
      this.ipcEndpoints.delete(endpoint);
      removed.push(publicIpcEndpoint(record));
    });
    if (removed.length) this.bus.emit("ipc:endpoint", {
      action: "unregister",
      reason,
      ownerNamespace: processGroup,
      ownerPackageId: packageId,
      endpoints: removed,
    });
    return removed;
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

function normalizeHandoffMode(mode) {
  const value = String(mode || "view").toLowerCase();
  return ["view", "control"].includes(value) ? value : "view";
}

function normalizeHandoffAction(action) {
  const value = String(action || "offer").toLowerCase();
  return ["offer", "accept", "cancel"].includes(value) ? value : "offer";
}

function normalizeHandoffRelayKind(kind) {
  const value = String(kind || "frame").toLowerCase();
  return ["frame", "input"].includes(value) ? value : "frame";
}

function normalizeHandoffInputType(type) {
  const value = String(type || "pointer").toLowerCase();
  return ["pointer", "keyboard", "wheel", "text"].includes(value) ? value : "pointer";
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).byteLength;
}

function snapshotSummary(snapshot) {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    backend: snapshot.backend,
    encrypted: Boolean(snapshot.encrypted),
    fileCount: Number(snapshot.fileCount || 0),
    bytes: Number(snapshot.bytes || 0),
    packageRecords: Number(snapshot.packageRecords || 0),
    appStateRecords: Number(snapshot.appStateRecords || 0),
    cacheRecords: Number(snapshot.cacheRecords || 0),
    settingsRecords: Number(snapshot.settingsRecords || 0),
  };
}

function cloneSyncStatusRecord(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function remoteSyncRefusalRecord(plan, index = 0) {
  return {
    path: plan.path,
    scope: plan.scope,
    policy: plan.policy,
    action: plan.action,
    reason: plan.reason,
    mime: plan.mime || "",
    bytes: Number(plan.bytes || 0),
    index,
  };
}

function isSafePackageRecordId(value) {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(String(value || "")) && !String(value || "").includes("..");
}

function normalizeMergeValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Uint8Array) return { type: "bytes", value: Array.from(value) };
  if (typeof value === "string") return { type: "text", value };
  return { type: "json", value };
}

function mergeValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isTextMergeCandidate(path, mime, ...values) {
  if (mime.startsWith("text/")) return true;
  if (["application/json", "application/markdown", "application/javascript"].includes(mime)) return true;
  if (/\.(txt|md|json|js|mjs|css|html|csv|log)$/i.test(path)) return true;
  return values.every((value) => value === null || value.type === "text");
}

function mergeTextValues(base, local, remote) {
  const baseText = base?.value ?? "";
  const localText = local?.value ?? "";
  const remoteText = remote?.value ?? "";
  if (localText === remoteText) return { clean: true, value: localText };
  if (localText === baseText) return { clean: true, value: remoteText };
  if (remoteText === baseText) return { clean: true, value: localText };
  if (localText.startsWith(baseText) && remoteText.startsWith(baseText)) {
    const localSuffix = localText.slice(baseText.length);
    const remoteSuffix = remoteText.slice(baseText.length);
    if (localSuffix && remoteSuffix && localSuffix !== remoteSuffix) {
      return { clean: true, value: `${baseText}${localSuffix}${remoteSuffix}` };
    }
  }
  return { clean: false, value: "" };
}

function mergeValueFromBytes(path, mime, bytes) {
  if (isTextMergeCandidate(path, mime, { type: "text", value: "" })) {
    return new TextDecoder().decode(bytes || new Uint8Array());
  }
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
}

function bytesEqual(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left || []);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right || []);
  if (a.byteLength !== b.byteLength) return false;
  return a.every((byte, index) => byte === b[index]);
}

function newestSide(localModified, remoteModified) {
  const localTime = Date.parse(localModified || "");
  const remoteTime = Date.parse(remoteModified || "");
  if (!Number.isFinite(localTime) && !Number.isFinite(remoteTime)) return "remote";
  if (!Number.isFinite(remoteTime)) return "local";
  if (!Number.isFinite(localTime)) return "remote";
  return remoteTime >= localTime ? "remote" : "local";
}

function syncConflictPath(path, modified = "") {
  const stamp = (modified && !Number.isNaN(Date.parse(modified)) ? new Date(modified) : new Date())
    .toISOString()
    .replace(/[:.]/g, "-");
  const normalized = String(path || "/remote").replace(/\/$/, "");
  const slash = normalized.lastIndexOf("/");
  const directory = slash > 0 ? normalized.slice(0, slash) : "/";
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${directory === "/" ? "" : directory}/.sync-conflicts/${name}.${stamp}.remote`;
}

function targetPathFromSyncConflict(conflictPath, fs) {
  const directory = fs.dirname(fs.dirname(conflictPath));
  const conflictName = fs.basename(conflictPath);
  const targetName = conflictName.replace(/\.\d{4}-\d{2}-\d{2}T.*Z\.remote$/, "");
  return fs.join(directory, targetName || conflictName);
}

function normalizeSyncConflictAction(action) {
  const value = String(action || "use-conflict").toLowerCase();
  if (["use-conflict", "keep-local", "delete-conflict"].includes(value)) return value;
  return "use-conflict";
}

function mountDriverForDiskArea(area) {
  if (area.root === "/opt") return "pkgfs";
  if (area.root === "/var/cache") return "cachefs";
  if (area.root === "/tmp") return "memfs";
  if (area.root === "/mnt") return "mountfs";
  if (area.root === "/var") return "statefs";
  return "browserfs";
}

function normalizeVirtualMountDriver(driver) {
  const value = String(driver || "memfs").toLowerCase();
  if (value === "memfs") return "memfs";
  if (value === "overlayfs") return "overlayfs";
  if (value === "zipfs") return "zipfs";
  throw codedError("ENOTSUP", `mount: unsupported driver: ${value}`);
}

function assertDirectoryLike(fs, path, label) {
  const node = fs.resolve(path);
  if (!node || (node.type !== "directory" && node.type !== "mount")) {
    throw codedError("ENOENT", `mount: overlayfs ${label}: ${path}: no such directory`);
  }
}

function materializeOverlayTree(fs, sourceRoot, targetRoot, principal) {
  fs.list(sourceRoot, "/", principal).forEach((entry) => {
    const targetPath = fs.join(targetRoot, entry.name);
    materializeOverlayEntry(fs, entry, targetPath, principal);
  });
}

function materializeOverlayEntry(fs, entry, targetPath, principal) {
  const existing = fs.resolve(targetPath);
  if (entry.type === "directory" || entry.type === "mount") {
    if (existing && existing.type !== "directory" && existing.type !== "mount") fs.remove(targetPath, "/", { recursive: true }, principal);
    if (!fs.exists(targetPath)) {
      fs.createDirectory(targetPath, "/", {
        owner: entry.owner || "root",
        group: entry.group || "root",
        permissions: entry.permissions || "dr-xr-xr-x",
      }, principal);
    }
    materializeOverlayTree(fs, entry.path, targetPath, principal);
    return;
  }
  if (existing) fs.remove(targetPath, "/", { recursive: true }, principal);
  if (entry.type === "file") {
    fs.writeOrCreateFileBytes(targetPath, fs.readFileBytes(entry.path, "/", principal), "/", {
      mime: entry.mime,
      owner: entry.owner || "root",
      group: entry.group || "root",
      permissions: entry.permissions || "-r--r--r--",
    }, principal);
    return;
  }
  if (entry.type === "link" || entry.type === "symlink") {
    fs.createSymlink(entry.target || "", targetPath, "/", {
      owner: entry.owner || "root",
      group: entry.group || "root",
      permissions: entry.permissions || "lrwxrwxrwx",
    }, principal);
    return;
  }
  fs.copy(entry.path, targetPath, "/", { recursive: true }, principal);
}

function parseStoredZipEntries(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const eocd = findZipEndOfCentralDirectory(data);
  const entryCount = readUint16(data, eocd + 10);
  const centralOffset = readUint32(data, eocd + 16);
  let cursor = centralOffset;
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(data, cursor) !== 0x02014b50) throw codedError("EINVAL", "mount: zipfs invalid central directory");
    const method = readUint16(data, cursor + 10);
    const compressedSize = readUint32(data, cursor + 20);
    const uncompressedSize = readUint32(data, cursor + 24);
    const nameLength = readUint16(data, cursor + 28);
    const extraLength = readUint16(data, cursor + 30);
    const commentLength = readUint16(data, cursor + 32);
    const localOffset = readUint32(data, cursor + 42);
    const name = decodeZipName(data.slice(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith("/")) continue;
    if (method !== 0) throw codedError("ENOTSUP", `mount: zipfs ${name}: compression method ${method} is not supported`);
    if (compressedSize !== uncompressedSize) throw codedError("EINVAL", `mount: zipfs ${name}: stored size mismatch`);
    entries.push({
      path: normalizeZipEntryPath(name),
      bytes: readStoredZipEntryBytes(data, localOffset, compressedSize),
    });
  }
  return entries;
}

function findZipEndOfCentralDirectory(data) {
  for (let offset = data.length - 22; offset >= 0 && offset >= data.length - 0xffff - 22; offset -= 1) {
    if (readUint32(data, offset) === 0x06054b50) return offset;
  }
  throw codedError("EINVAL", "mount: zipfs end of central directory not found");
}

function readStoredZipEntryBytes(data, localOffset, compressedSize) {
  if (readUint32(data, localOffset) !== 0x04034b50) throw codedError("EINVAL", "mount: zipfs invalid local file header");
  const nameLength = readUint16(data, localOffset + 26);
  const extraLength = readUint16(data, localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  return data.slice(start, start + compressedSize);
}

function materializeZipEntry(fs, root, entry, principal) {
  const target = fs.join(root, entry.path);
  ensureZipParentDirectories(fs, fs.dirname(target), root, principal);
  fs.writeOrCreateFileBytes(target, entry.bytes, "/", {
    mime: mimeFromZipPath(entry.path),
    owner: "root",
    group: "root",
    permissions: "-r--r--r--",
  }, principal);
}

function ensureZipParentDirectories(fs, directory, root, principal) {
  if (directory === root || fs.exists(directory)) return;
  ensureZipParentDirectories(fs, fs.dirname(directory), root, principal);
  fs.createDirectory(directory, "/", {
    owner: "root",
    group: "root",
    permissions: "dr-xr-xr-x",
  }, principal);
}

function normalizeZipEntryPath(path) {
  const normalized = String(path || "").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.split("/").some((part) => !part)) {
    throw codedError("EINVAL", `mount: zipfs invalid entry path: ${path}`);
  }
  return normalized;
}

function decodeZipName(bytes) {
  return new TextDecoder().decode(bytes);
}

function readUint16(data, offset) {
  return data[offset] | (data[offset + 1] << 8);
}

function readUint32(data, offset) {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function mimeFromZipPath(path) {
  if (/\.json$/i.test(path)) return "application/json";
  if (/\.md$/i.test(path)) return "text/markdown";
  if (/\.txt$/i.test(path)) return "text/plain";
  return "application/octet-stream";
}

function formatMountTableLine(entry) {
  const flags = entry.readonly ? "ro" : "rw";
  const caps = Array.isArray(entry.capabilities) && entry.capabilities.length ? entry.capabilities.join(",") : "-";
  return [
    entry.id,
    entry.root,
    entry.driver,
    flags,
    `owner=${entry.owner || "root"}`,
    `durability=${entry.durability || "runtime"}`,
    `quota=${entry.quotaPolicy || "unknown"}`,
    `usedBytes=${Number(entry.usedBytes || 0)}`,
    `support=${entry.support || "browser-vfs"}`,
    `caps=${caps}`,
  ].join(" ");
}

function normalizeIpcEndpoint(endpoint) {
  const value = String(endpoint || "").trim();
  if (!value || value.length > 128 || /[\s/]/.test(value)) throw new Error(`ipc: invalid endpoint: ${endpoint || ""}`);
  return value;
}

function assertIpcEndpointAllowed(process, endpoint, action) {
  const namespace = process?.manifest?.namespace || null;
  if (!namespace) return;
  if ((namespace.ipcEndpoints || []).includes(endpoint)) return;
  throw new Error(`ipc: ${endpoint}: ${action} denied by package namespace`);
}

function assertIpcSendAllowed(process, record) {
  const namespace = process?.manifest?.namespace || null;
  if (!namespace) return;
  if (namespace.processGroup && namespace.processGroup === record.ownerNamespace) return;
  if ((namespace.ipcEndpoints || []).includes(record.endpoint)) return;
  throw new Error(`ipc: ${record.endpoint}: send denied by package namespace`);
}

function canSeeIpcEndpoint(process, record) {
  try {
    assertIpcSendAllowed(process, record);
    return true;
  } catch {
    return false;
  }
}

function publicIpcEndpoint(record) {
  return {
    endpoint: record.endpoint,
    ownerPid: record.ownerPid,
    ownerAppId: record.ownerAppId,
    ownerNamespace: record.ownerNamespace,
    ownerPackageId: record.ownerPackageId || "",
    createdAt: record.createdAt,
  };
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function encryptRemoteSyncPayload(payload, passphrase) {
  const subtle = globalThis.crypto?.subtle;
  const random = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  if (!subtle || !random) throw new Error("remote sync encryption requires WebCrypto");
  const encoder = new TextEncoder();
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  random(salt);
  random(iv);
  const keyMaterial = await subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(payload)));
  return {
    algorithm: "AES-GCM/PBKDF2-SHA-256",
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptRemoteSyncPayload(snapshot, passphrase) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("remote sync decryption requires WebCrypto");
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const salt = base64ToBytes(snapshot.salt || "");
  const iv = base64ToBytes(snapshot.iv || "");
  const ciphertext = base64ToBytes(snapshot.ciphertext || "");
  const keyMaterial = await subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plaintext = await subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(decoder.decode(plaintext));
}

function bytesToBase64(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(value).toString("base64");
}

function base64ToBytes(value) {
  const text = String(value || "");
  if (typeof atob === "function") {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  return new Uint8Array(Buffer.from(text, "base64"));
}

export { AppRegistry, AppSandbox, DescriptorManager, RuntimeCacheStore, DesktopShell, EventBus, LocalFolderMountManager, NodeCompat, NpmInstaller, PackageManager, PermissionPolicy, PersistentStorage, ProcessManager, SyscallDispatcher, VirtualFileSystem, WasmRunner, WindowManager };
