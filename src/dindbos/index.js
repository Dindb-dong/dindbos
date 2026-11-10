import { AppRegistry } from "./app-registry.js";
import { AppSandbox } from "./app-sandbox.js";
import { compatibilitySnapshot, conformanceReport, isolationSnapshot } from "./compat.js";
import { DescriptorManager } from "./descriptors.js";
import { RuntimeCacheStore } from "./cache-store.js";
import { DesktopShell } from "./desktop-shell.js";
import { normalizeUIStylePreference } from "./ui-style.js";
import { EventBus } from "./event-bus.js";
import { KeychainManager } from "./keychain.js";
import { KernelObjectRegistry } from "./kernel-objects.js";
import { LocalFolderMountManager } from "./local-folder-mount.js";
import { NetworkBroker } from "./network-broker.js";
import { NodeCompat } from "./node-compat.js";
import { NpmInstaller } from "./npm-installer.js";
import { PackageManager } from "./package-manager.js";
import { PermissionPolicy } from "./permission-policy.js";
import { PersistentStorage } from "./persistent-storage.js";
import { ProcessExecutor } from "./process-executor.js";
import { ProcessManager } from "./process-manager.js";
import { ServiceManager } from "./service-manager.js";
import { StorageTransactionManager } from "./storage-transaction-manager.js";
import { SyscallDispatcher } from "./syscalls.js";
import { TimerManager } from "./timer-manager.js";
import { TrustedPromptManager } from "./trusted-prompt-manager.js";
import { VirtualFileSystem } from "./vfs.js";
import { WasmRunner } from "./wasm-runner.js";
import { WindowManager } from "./window-manager.js";
import { DEFAULT_APPEARANCE, normalizeAppearance, applyAppearance } from "./appearance.js";

const runtimeHosts = new WeakMap();

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
const SERVICE_WORKER_BOOT_PATH = "/var/run/dindbos/service-worker-boot.json";
const OFFLINE_MAINTENANCE_QUEUE_PATH = "/var/run/dindbos/offline-maintenance-queue.json";
const PANIC_DIAGNOSTICS_PATH = "/var/run/dindbos/panic.json";
const RECOVERY_SHELL_DIR = "/var/recovery/shell";
const SECURE_BOOT_PATH = "/var/run/dindbos/secure-boot.json";
const CONFORMANCE_EVIDENCE_PATH = "/var/run/dindbos/conformance-evidence.json";
const SESSION_LOCK_STORAGE_KEY = "dindbos:session-lock";
const OPERATION_LOCK_PREFIX = "dindbos:operation-lock:";
const REMOTE_SYNC_SNAPSHOT_KEY = "dindbos:remote-sync:last-snapshot";
const REMOTE_SYNC_APPLY_STATUS_PATH = "/var/run/dindbos/remote-sync-apply.json";
const PACKAGE_PREFERENCES_DIR = "/var/lib/dindbos/package-preferences";
const COMPANION_PERMISSIONS_PATH = "/etc/dindbos/companions.json";
const WELL_KNOWN_GROUP_IDS = { root: 0, admins: 10, users: 100, packages: 101 };
const WELL_KNOWN_USER_IDS = { root: 0, guest: 1000 };
const BROWSER_CAPABILITY_PROBES = [
  { id: "clipboard.read", api: "navigator.clipboard.readText", broker: "clipboard", device: "/dev/browser/clipboard" },
  { id: "clipboard.write", api: "navigator.clipboard.writeText", broker: "clipboard", device: "/dev/browser/clipboard" },
  { id: "notifications.show", api: "Notification", broker: "notifications", device: "/dev/browser/notifications" },
  { id: "localFile.open", api: "showOpenFilePicker", broker: "local-files", device: "/dev/browser/files" },
  { id: "localFile.save", api: "showSaveFilePicker", broker: "local-files", device: "/dev/browser/files" },
  { id: "localDirectory.open", api: "showDirectoryPicker", broker: "local-files", device: "/dev/browser/files" },
  { id: "screen.capture", api: "navigator.mediaDevices.getDisplayMedia", broker: "screen-capture", device: "/dev/browser/screen" },
  { id: "media.audioVideo", api: "navigator.mediaDevices.getUserMedia", broker: "media-devices", device: "/dev/browser/media" },
  { id: "media.enumerate", api: "navigator.mediaDevices.enumerateDevices", broker: "media-devices", device: "/dev/browser/media" },
  { id: "webShare.share", api: "navigator.share", broker: "web-share", device: "/dev/browser/share" },
  { id: "webrtc.peerConnection", api: "RTCPeerConnection", broker: "webrtc", device: "/dev/browser/webrtc" },
  { id: "webgpu.adapter", api: "navigator.gpu", broker: "webgpu", device: "/dev/browser/gpu" },
  { id: "webusb.device", api: "navigator.usb", broker: "webusb", device: "/dev/browser/usb" },
  { id: "webserial.port", api: "navigator.serial", broker: "webserial", device: "/dev/browser/serial" },
  { id: "webhid.device", api: "navigator.hid", broker: "webhid", device: "/dev/browser/hid" },
];

export class DindbOS {
  constructor(options = {}) {
    this.root = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
    this.destroyed = false;
    this.destroyPromise = null;
    this.lifecycleCleanups = [];
    this.memoryOnly = options.storageBackend === "memory";
    this.operationLocks = new Map();
    this.uiOptions = options.uiOptions || {};
    if (this.root) {
      this.root.classList?.add("dindbos-host");
      runtimeHosts.set(this.root, this);
    }
    this.appearanceStorageKey = `${options.storageKey || options.storage?.key || "dindbos:vfs"}:appearance`;
    this.uiStyleStorageKey = `${options.storageKey || options.storage?.key || "dindbos:vfs"}:ui-style`;
    this.uiStylePreference = {};
    this.uiStyleSaveFailed = false;
    try {
      if (!this.memoryOnly) this.uiStylePreference = normalizeUIStylePreference(JSON.parse(globalThis.localStorage?.getItem(this.uiStyleStorageKey) || "{}"));
    } catch { /* Invalid or unavailable storage keeps automatic UI selection. */ }
    let savedAppearance = {};
    try { if (!this.memoryOnly) savedAppearance = JSON.parse(globalThis.localStorage?.getItem(this.appearanceStorageKey) || "{}"); } catch { /* Browser storage can be unavailable. */ }
    try { this.appearance = normalizeAppearance(savedAppearance); } catch { this.appearance = { ...DEFAULT_APPEARANCE }; }
    this.appearanceMedia = globalThis.window?.matchMedia?.("(prefers-color-scheme: dark)");
    const updateSystemAppearance = () => {
      applyAppearance(this.root, this.appearance, this.appearanceMedia?.matches);
      this.bus?.emit("appearance:change", { ...this.appearance });
    };
    this.appearanceMedia?.addEventListener?.("change", updateSystemAppearance);
    this.lifecycleCleanups.push(() => this.appearanceMedia?.removeEventListener?.("change", updateSystemAppearance));
    applyAppearance(this.root, this.appearance, this.appearanceMedia?.matches);
    this.instanceId = String(options.instanceId || `runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    const storageNamespace = options.storageKey || options.storage?.key || "dindbos:vfs";
    this.coordinationNamespace = this.memoryOnly ? `${storageNamespace}:${this.instanceId}` : storageNamespace;
    this.coordinationSuffix = this.coordinationNamespace === "dindbos:vfs" ? "" : `:${encodeURIComponent(this.coordinationNamespace)}`;
    this.sessionLockStorageKey = `${SESSION_LOCK_STORAGE_KEY}${this.coordinationSuffix}`;
    this.session = normalizeSession(options.session || {});
    this.sessionId = String(options.sessionId || this.session.sessionId || `${this.session.user}:${this.instanceId}`);
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
      authMethod: this.session.locked ? "" : "session-placeholder",
      loggedOutAt: "",
      lastLoginAt: this.session.locked ? "" : new Date().toISOString(),
    };
    this.bus = new EventBus();
    this.sessionChannelName = options.sessionChannelName || `dindbos:session-events${this.coordinationSuffix}`;
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
    this.lastStorageRepair = null;
    this.offlineMaintenanceQueue = [];
    this.conformanceEvidence = [];
    this.lastServiceWorkerBoot = null;
    this.activeSafeBootProfileId = normalizeSafeBootProfileId(options.safeBootProfile || options.bootProfile || "normal");
    this.safeBootDecisions = [];
    this.recoveryPanic = null;
    this.ipcEndpoints = new Map();
    this.workerMemoryRegions = new Map();
    this.virtualMounts = new Map();
    this.overlayMounts = new Map();
    this.privacyLedger = [];
    this.browserBrokerRequests = [];
    this.browserGrantRevocations = new Map();
    this.permissions = new PermissionPolicy({ defaultUser: this.session.user, defaultGroups: this.session.groups });
    this.storage = options.storage || new PersistentStorage({ key: options.storageKey || "dindbos:vfs", memoryOnly: options.storageBackend === "memory" });
    if (typeof this.storage.status !== "function") {
      this.storage = new Proxy(this.storage, {
        get(target, key) {
          if (key === "status") return () => ({ backend: "custom", enabled: true });
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
    this.cache = options.cache || new RuntimeCacheStore({ name: options.cacheName || "dindbos-runtime-cache-v1", user: this.session.user });
    this.cache.setUser?.(this.session.user);
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
    this.persistFlushPromise = null;
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
    this.objects = new KernelObjectRegistry(this);
    this.processes = new ProcessManager(this);
    this.services = new ServiceManager(this);
    this.executor = new ProcessExecutor(this);
    this.descriptors = new DescriptorManager(this);
    this.timers = new TimerManager(this, options.timers || {});
    this.storageTransactions = new StorageTransactionManager(this);
    this.trustedPrompts = new TrustedPromptManager(this, options.trustedPrompts || {});
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
        if (this.destroyed) return;
        if (this.shouldPersistFileChange(event.path)) this.schedulePersistFileSystem(event);
        const message = this.publishSessionEvent("file-change", event);
        this.recordSessionFileChange(this.instanceId, event, message?.at);
      },
      onAccessDenied: (event) => this.auditDeniedFileSystemAccess(event),
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

  shouldPersistFileChange(path) {
    if (!path) return true;
    return !String(path).startsWith("/proc");
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
    this.writeBrowserDeviceProcfs("disk-policy-roots");
    this.writeStorageKernelProcfs("disk-policy-roots");
    this.writeIsolationProcfs("disk-policy-roots");
    this.writeRecoveryShellAssets();
    this.writeServiceWorkerBootProcfs("disk-policy-roots");
    this.writeConformanceProcfs("disk-policy-roots");
    this.ensureUserGroupDatabase();
    this.ensureSessionHome();
    this.writeSecureBootProcfs("disk-policy-roots");
    this.writeSessionStatus();
    await this.coordinateSessionLock();
    this.writeSessionStatus();
    this.recoverPreviousShutdown();
  }

  boot() {
    if (this.destroyed) throw new DOMException("Runtime was destroyed", "AbortError");
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
    this.writeSecureBootProcfs("boot-complete");
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
    const detailText = formatBootPhaseDetail(detail);
    Object.assign(phase, {
      status,
      detail: detailText || (status === "complete" ? `${phase.label} complete` : ""),
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
      serviceWorkerBoot: this.lastServiceWorkerBoot || this.serviceWorkerBootStatus(),
      safeBootProfiles: this.safeBootProfiles(),
      safeBootEnforcement: this.safeBootEnforcementStatus(),
      offlineMaintenanceQueue: this.offlineMaintenanceQueueStatus(),
      panic: this.recoveryPanic,
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
        processedFiles: 0,
        remainingFiles: Math.max(0, files.length - startIndex),
        dryRun,
      });
      let appliedFiles = 0;
      let lastPlanned = null;
      for (let index = startIndex; index < files.length; index += 1) {
        if (appliedFiles >= maxFiles) {
          result.status = "interrupted";
          break;
        }
        const file = files[index];
        const planned = this.planRemoteSyncApplyFile(file, options);
        lastPlanned = planned;
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
          currentPath: planned.path,
          currentAction: planned.action,
          processedFiles: result.nextIndex - startIndex,
          remainingFiles: Math.max(0, files.length - result.nextIndex),
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
        currentPath: lastPlanned?.path || "",
        currentAction: lastPlanned?.action || "",
        processedFiles: result.nextIndex - startIndex,
        remainingFiles: Math.max(0, files.length - result.nextIndex),
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
      processedFiles: Number(run.processedFiles || 0),
      remainingFiles: Number(run.remainingFiles || 0),
      currentPath: String(run.currentPath || ""),
      currentAction: String(run.currentAction || ""),
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
    const serviceWorkerBoot = this.serviceWorkerBootStatus();
    const serviceWorkerSupported = Boolean(serviceWorkerBoot.supported);
    const periodicSyncSupported = Boolean(
      globalThis.PeriodicSyncManager
      || globalThis.ServiceWorkerRegistration?.prototype?.periodicSync,
    );
    return {
      serviceWorkerSupported,
      periodicSyncSupported,
      registered: Boolean(serviceWorkerBoot.registered),
      permissionRequired: serviceWorkerSupported,
      closedPagePersistence: false,
      decision: serviceWorkerSupported
        ? serviceWorkerBoot.decision
        : "unsupported-in-this-runtime",
      reason: serviceWorkerSupported
        ? serviceWorkerBoot.reason
        : "This runtime has no Service Worker controller, so DindbOS cannot claim closed-page service execution.",
      serviceWorkerBoot,
      offlineMaintenanceQueue: this.offlineMaintenanceQueueStatus(),
    };
  }

  safeBootProfiles() {
    const storage = safeRead(() => this.storage.status(), {});
    const serviceWorkerSupported = Boolean(globalThis.navigator?.serviceWorker);
    return [
      { id: "normal", status: "available", disables: [], reason: "standard boot path" },
      { id: "safe-mode", status: "available", disables: ["packages", "services", "companions"], reason: "minimal desktop and shell for recovery" },
      { id: "package-disabled", status: "available", disables: ["packages"], reason: "skip package activation when package records are suspect" },
      { id: "service-disabled", status: "available", disables: ["services"], reason: "skip resumable services after crash or hidden-tab suspension" },
      { id: "companion-disabled", status: "available", disables: ["companions"], reason: "avoid native-adjacent helpers until trust is re-established" },
      { id: "offline", status: serviceWorkerSupported ? "available" : "degraded", disables: ["remote-network"], reason: serviceWorkerSupported ? "service worker can serve recovery shell assets" : "no Service Worker support; local VFS recovery only" },
      { id: "storage-repair", status: storage.backend ? "available" : "degraded", disables: ["app-autostart"], reason: "run fsck/storage repair before normal app launch" },
    ].map((profile) => ({ ...profile, active: profile.id === this.activeSafeBootProfileId }));
  }

  activeSafeBootProfile() {
    return this.safeBootProfiles().find((profile) => profile.id === this.activeSafeBootProfileId) || this.safeBootProfiles()[0];
  }

  safeBootEnforcementStatus() {
    const profile = this.activeSafeBootProfile();
    return {
      version: 1,
      activeProfile: profile.id,
      status: profile.status,
      disables: [...(profile.disables || [])],
      reason: profile.reason,
      decisions: this.safeBootDecisions.slice(-50).map((entry) => ({ ...entry })),
      profiles: this.safeBootProfiles(),
    };
  }

  setSafeBootProfile(profileId = "normal", reason = "manual") {
    const id = normalizeSafeBootProfileId(profileId);
    if (!this.safeBootProfiles().some((profile) => profile.id === id)) throw new Error(`safe-boot: unknown profile: ${profileId}`);
    this.activeSafeBootProfileId = id;
    this.recordSafeBootDecision("profile", id, id === "normal" ? "allowed" : "active", reason);
    this.writeServiceWorkerBootProcfs("safe-boot-profile-change");
    return this.safeBootEnforcementStatus();
  }

  isSafeBootDisabled(capability) {
    return (this.activeSafeBootProfile().disables || []).includes(capability);
  }

  assertSafeBootAllows(capability, action = capability, target = "") {
    if (!this.isSafeBootDisabled(capability)) {
      this.recordSafeBootDecision(action, target || capability, "allowed", `${this.activeSafeBootProfileId} permits ${capability}`);
      return true;
    }
    const message = `safe-boot: profile ${this.activeSafeBootProfileId} disables ${capability}`;
    this.recordSafeBootDecision(action, target || capability, "blocked", message);
    throw codedError("EBOOTPROFILE", message);
  }

  recordSafeBootDecision(action, target, status, detail = "") {
    const record = {
      action: String(action || ""),
      target: String(target || ""),
      status: String(status || ""),
      profile: this.activeSafeBootProfileId,
      detail: String(detail || ""),
      at: new Date().toISOString(),
    };
    this.safeBootDecisions.push(record);
    this.safeBootDecisions = this.safeBootDecisions.slice(-100);
    return record;
  }

  serviceWorkerBootStatus(reason = "status") {
    const registration = this.lastServiceWorkerBoot?.registration || null;
    const supported = Boolean(globalThis.navigator?.serviceWorker);
    const controller = globalThis.navigator?.serviceWorker?.controller || null;
    const registered = Boolean(registration || controller);
    const controlled = Boolean(controller);
    return {
      service: "dindbos-service-worker-boot",
      version: 1,
      statusReason: String(reason || "status"),
      updatedAt: new Date().toISOString(),
      supported,
      registered,
      controlled,
      scriptURL: registration?.scriptURL || controller?.scriptURL || "/dindbos-sw.js",
      scope: registration?.scope || globalThis.location?.origin || "",
      controllerState: controller?.state || registration?.active?.state || "",
      manifest: {
        runtime: "DindbOS.js",
        protocol: "dindbos-sw-boot.v1",
        assets: ["/", "/index.html", "/dindbos-sw.js"],
        safeBootProfiles: ["normal", "safe-mode", "package-disabled", "service-disabled", "companion-disabled", "offline", "storage-repair"],
        recoveryShell: `${RECOVERY_SHELL_DIR}/recovery.dindbsh`,
      },
      handshake: {
        status: controlled ? "controlled" : registered ? "registered-waiting-for-controller" : "uncontrolled",
        hello: "dindbos:boot:hello",
        ready: "dindbos:boot:ready",
        lastReadyAt: this.lastServiceWorkerBoot?.lastReadyAt || "",
      },
      closedPageExecution: false,
      decision: supported
        ? (registered ? "registered-browser-mediated-cache-only" : "available-but-not-registered")
        : "unsupported-in-this-runtime",
      reason: supported
        ? "Service Worker can cache boot/recovery assets, but DindbOS still does not claim arbitrary closed-page execution."
        : "Service Worker support is unavailable in this runtime.",
    };
  }

  async registerServiceWorkerBoot(scriptURL = "/dindbos-sw.js", options = {}) {
    const serviceWorker = globalThis.navigator?.serviceWorker;
    if (!serviceWorker?.register) {
      const status = this.serviceWorkerBootStatus("register-unavailable");
      this.lastServiceWorkerBoot = status;
      this.writeServiceWorkerBootProcfs("register-unavailable");
      return status;
    }
    try {
      const registration = await serviceWorker.register(scriptURL, { scope: options.scope || "/" });
      this.lastServiceWorkerBoot = {
        ...this.serviceWorkerBootStatus("registered"),
        registration: {
          scope: registration.scope || "",
          scriptURL,
          active: registration.active ? { state: registration.active.state || "" } : null,
        },
        lastReadyAt: new Date().toISOString(),
      };
      this.handshakeServiceWorkerBoot();
      this.writeServiceWorkerBootProcfs("registered");
      return this.lastServiceWorkerBoot;
    } catch (error) {
      this.lastServiceWorkerBoot = {
        ...this.serviceWorkerBootStatus("register-error"),
        error: error?.message || String(error),
        decision: "registration-failed",
      };
      this.writeServiceWorkerBootProcfs("register-error");
      return this.lastServiceWorkerBoot;
    }
  }

  handshakeServiceWorkerBoot() {
    const controller = globalThis.navigator?.serviceWorker?.controller;
    if (!controller?.postMessage) return false;
    controller.postMessage({
      type: "dindbos:boot:hello",
      protocol: "dindbos-sw-boot.v1",
      instanceId: this.instanceId,
      safeBootProfiles: this.safeBootProfiles().map((profile) => profile.id),
    });
    return true;
  }

  queueOfflineMaintenanceTask(task = {}, context = {}) {
    const type = String(task.type || task.action || "").trim();
    const allowedTypes = ["storage.flush", "sync.retry", "fsck.dry-run", "recovery.export"];
    if (!allowedTypes.includes(type)) throw new Error(`offline-maintenance: unsupported task: ${type || "unknown"}`);
    if (!task.permissioned && !task.allowOffline && context.principal?.system !== true) {
      throw new Error("offline-maintenance: task requires explicit offline maintenance permission");
    }
    const record = {
      id: String(task.id || `offline-task-${Date.now().toString(36)}-${this.offlineMaintenanceQueue.length + 1}`),
      type,
      status: "queued",
      permissioned: true,
      createdAt: new Date().toISOString(),
      requestedBy: String(task.requestedBy || context.principal?.user || this.session.user),
      payload: cloneJson(task.payload || {}),
    };
    this.offlineMaintenanceQueue.push(record);
    this.writeOfflineMaintenanceQueue();
    this.writeServiceWorkerBootProcfs("offline-task-queued");
    return { ...record };
  }

  offlineMaintenanceQueueStatus() {
    return {
      version: 1,
      queued: this.offlineMaintenanceQueue.length,
      tasks: this.offlineMaintenanceQueue.map((task) => ({ ...task })),
    };
  }

  writeOfflineMaintenanceQueue() {
    const system = this.permissions.systemPrincipal();
    this.ensureDirectoryPath("/var/run/dindbos", {
      leafOwner: "root",
      leafGroup: "root",
      leafPermissions: "drwxr-xr-x",
      principal: system,
    });
    this.fs.writeOrCreateFile(OFFLINE_MAINTENANCE_QUEUE_PATH, `${JSON.stringify(this.offlineMaintenanceQueueStatus(), null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
  }

  writeServiceWorkerBootProcfs(reason = "service-worker-boot") {
    if (!this.fs?.exists?.("/proc")) return null;
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/proc", "root", system);
    this.ensureDirectoryPath("/var/run/dindbos", {
      leafOwner: "root",
      leafGroup: "root",
      leafPermissions: "drwxr-xr-x",
      principal: system,
    });
    const status = {
      ...this.serviceWorkerBootStatus(reason),
      safeBootProfiles: this.safeBootProfiles(),
      safeBootEnforcement: this.safeBootEnforcementStatus(),
      offlineMaintenanceQueue: this.offlineMaintenanceQueueStatus(),
      panic: this.recoveryPanic,
    };
    this.fs.writeOrCreateFile(SERVICE_WORKER_BOOT_PATH, `${JSON.stringify(status, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/proc/service-worker-boot.json", `${JSON.stringify(status, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/proc/service-worker-boot", `${formatServiceWorkerBootStatus(status)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "text/plain",
    }, system);
    this.writeOfflineMaintenanceQueue();
    return status;
  }

  writeRecoveryShellAssets() {
    const system = this.permissions.systemPrincipal();
    this.ensureDirectoryPath(RECOVERY_SHELL_DIR, {
      leafOwner: "root",
      leafGroup: "root",
      leafPermissions: "drwxr-xr-x",
      principal: system,
    });
    this.fs.writeOrCreateFile(`${RECOVERY_SHELL_DIR}/README.md`, [
      "# DindbOS Recovery Shell",
      "",
      "This directory contains browser-safe recovery assets for safe boot profiles.",
      "It is usable while the page is open and can be cached by the Service Worker boot profile.",
      "",
    ].join("\n"), "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "text/markdown",
    }, system);
    this.fs.writeOrCreateFile(`${RECOVERY_SHELL_DIR}/recovery.dindbsh`, [
      "#!/bin/dindbsh",
      "doctor",
      "storage fsck --dry-run",
      "cat /proc/service-worker-boot",
      "",
    ].join("\n"), "/", {
      owner: "root",
      group: "root",
      permissions: "-rwxr-xr-x",
      mime: "text/x-shellscript",
    }, system);
    this.writePanicDiagnostics("none", { bootProfiles: this.safeBootProfiles().map((profile) => profile.id) });
  }

  writePanicDiagnostics(reason = "panic", details = {}) {
    const system = this.permissions.systemPrincipal();
    this.ensureDirectoryPath("/var/run/dindbos", {
      leafOwner: "root",
      leafGroup: "root",
      leafPermissions: "drwxr-xr-x",
      principal: system,
    });
    this.recoveryPanic = {
      recordedAt: new Date().toISOString(),
      reason: String(reason || "panic"),
      details: cloneJson(details || {}),
      recoveryShell: `${RECOVERY_SHELL_DIR}/recovery.dindbsh`,
      safeBootProfiles: this.safeBootProfiles().map((profile) => profile.id),
    };
    this.fs.writeOrCreateFile(PANIC_DIAGNOSTICS_PATH, `${JSON.stringify(this.recoveryPanic, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    return this.recoveryPanic;
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
      serviceWorkerBoot: this.lastServiceWorkerBoot || this.serviceWorkerBootStatus("recovery-record"),
      safeBootProfiles: this.safeBootProfiles(),
      safeBootEnforcement: this.safeBootEnforcementStatus(),
      offlineMaintenanceQueue: this.offlineMaintenanceQueueStatus(),
      panic: this.recoveryPanic,
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

  secureBootReport(reason = "status") {
    const measurements = this.secureBootMeasurements(reason);
    const policyProofs = safeRead(() => this.packages?.policyProofs?.(), {
      service: "dindbos-policy-proof",
      ok: true,
      packageCount: 0,
      failed: 0,
      packages: [],
    });
    const summary = {
      measurementCount: measurements.length,
      missingCount: measurements.filter((entry) => entry.status === "missing").length,
      packageCount: this.packages?.list?.().length || 0,
      appCount: this.apps?.list?.().length || 0,
      publisherCount: this.packages?.trustedPublishers?.().length || 0,
      policyProofFailures: policyProofs.failed || 0,
    };
    return {
      service: "dindbos-secure-boot",
      version: 1,
      profile: "browser-measured-boot",
      reason: String(reason || "status"),
      generatedAt: new Date().toISOString(),
      ok: summary.missingCount === 0 && Boolean(policyProofs.ok),
      algorithm: "dindbos-stable-fnv1a64",
      summary,
      measurements,
      policyProofs,
    };
  }

  secureBootMeasurements(reason = "status") {
    const entries = [];
    const add = (kind, target, payload = null) => {
      const value = payload ?? safeRead(() => this.fs.readFile(target), null);
      entries.push({
        id: `${kind}:${target}`,
        kind,
        target,
        status: value === null || value === undefined ? "missing" : "measured",
        digest: value === null || value === undefined ? "" : stableDigest(value),
        bytes: value === null || value === undefined ? 0 : byteLength(typeof value === "string" ? value : stableStringify(value)),
        reason: String(reason || "status"),
      });
    };
    [
      "/etc/dindbos/users.json",
      "/etc/dindbos/groups.json",
      "/proc/mounts.json",
      "/proc/device-tree.json",
      "/proc/conformance.json",
    ].forEach((path) => add("base-file", path));
    (this.packages?.list?.() || [])
      .map((record) => this.packages.packageRecordPath?.(record.id) || `/var/lib/dindbos/packages/${record.id}.json`)
      .sort()
      .forEach((path) => add("package-record", path));
    (this.apps?.manifests?.() || [])
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .forEach((manifest) => add("app-registry", manifest.id || "unknown", manifest));
    (this.packages?.trustedPublishers?.() || [])
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .forEach((publisher) => add("trusted-publisher", publisher.id || "unknown", publisher));
    return entries;
  }

  writeSecureBootProcfs(reason = "secure-boot") {
    if (!this.fs.exists("/proc")) return null;
    const system = this.permissions.systemPrincipal();
    const report = this.secureBootReport(reason);
    this.ensureSystemDirectory("/var", "root", system);
    this.ensureSystemDirectory("/var/run", "root", system);
    this.ensureSystemDirectory("/var/run/dindbos", "root", system);
    this.fs.writeOrCreateFile(SECURE_BOOT_PATH, `${JSON.stringify(report, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/proc/secure-boot.json", `${JSON.stringify(report, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/proc/secure-boot", `${formatSecureBootReport(report)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "text/plain",
    }, system);
    return report;
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
      secureBoot: this.secureBootReport("boot-diagnostics"),
      serviceWorkerBoot: this.lastServiceWorkerBoot || this.serviceWorkerBootStatus("boot-diagnostics"),
      safeBootProfiles: this.safeBootProfiles(),
      safeBootEnforcement: this.safeBootEnforcementStatus(),
      offlineMaintenanceQueue: this.offlineMaintenanceQueueStatus(),
      panic: this.recoveryPanic,
    };
    this.fs.writeOrCreateFile("/var/log/dindbos/boot.json", `${stringifyDiagnosticsJson(payload, 2)}\n`, "/", {
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
    ["/proc", "/dev", "/dev/pts"].forEach((root) => this.ensureSystemDirectory(root, "root", system));
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
    const groupsPath = "/etc/dindbos/groups.json";
    if (!this.fs.exists(path)) {
      const groups = this.fs.exists(groupsPath) ? safeJson(this.fs.readFile(groupsPath, "/", this.permissions.systemPrincipal()), {})?.groups : {};
      return normalizeUserGroupDatabase({ users: {}, groups });
    }
    try {
      const parsed = JSON.parse(this.fs.readFile(path, "/", this.permissions.systemPrincipal()));
      const groupsFile = this.fs.exists(groupsPath) ? safeJson(this.fs.readFile(groupsPath, "/", this.permissions.systemPrincipal()), {}) : {};
      return normalizeUserGroupDatabase({
        users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
        groups: parsed.groups && typeof parsed.groups === "object" ? parsed.groups : groupsFile.groups,
      });
    } catch {
      return normalizeUserGroupDatabase({ users: {}, groups: {} });
    }
  }

  writeUserGroupDatabase(database) {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/etc", "root", system);
    this.ensureSystemDirectory("/etc/dindbos", "root", system);
    const normalized = normalizeUserGroupDatabase(database);
    normalized.updatedAt = new Date().toISOString();
    this.fs.writeOrCreateFile("/etc/dindbos/users.json", `${JSON.stringify(normalized, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/etc/dindbos/groups.json", `${JSON.stringify({ groups: normalized.groups, updatedAt: normalized.updatedAt }, null, 2)}\n`, "/", {
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
    const normalized = this.writeUserGroupDatabase(database);
    return { ...normalized.groups[group], members: [...(normalized.groups[group].members || [])] };
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
    const normalized = this.writeUserGroupDatabase(database);
    this.ensureUserHome(user, groups[0] || "users", home);
    return { ...normalized.users[user], groups: [...normalized.users[user].groups] };
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
    const normalized = this.writeUserGroupDatabase(database);
    return {
      user: { ...normalized.users[user], groups: [...normalized.users[user].groups] },
      group: { ...normalized.groups[group], members: [...normalized.groups[group].members] },
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
    const normalized = this.writeUserGroupDatabase(database);
    return { ...normalized.users[user], groups: [...normalized.users[user].groups] };
  }

  credentialsForUser(userName = this.session.user, groups = this.session.groups) {
    const user = sanitizeUserName(userName || this.session.user);
    const database = this.userGroupDatabase();
    const record = database.users[user] || {
      user,
      uid: uidForUser(user, nextIdentityId(Object.values(database.users || {}).map((entry) => entry.uid), 1000)),
      home: normalizeHomePath("", user),
      groups: sanitizeGroups(groups),
    };
    const groupNames = sanitizeGroups(record.groups?.length ? record.groups : groups);
    const primaryGroup = groupNames[0] || "users";
    const group = database.groups[primaryGroup] || { group: primaryGroup, gid: gidForGroup(primaryGroup, 100) };
    const supplementaryGids = [...new Set(groupNames.map((name) => gidForGroup(name, database.groups[name]?.gid ?? 100)))];
    return {
      user,
      uid: Number(record.uid ?? uidForUser(user, 1000)),
      gid: Number(group.gid ?? gidForGroup(primaryGroup, 100)),
      euid: Number(record.uid ?? uidForUser(user, 1000)),
      egid: Number(group.gid ?? gidForGroup(primaryGroup, 100)),
      groups: groupNames,
      supplementaryGids,
      home: record.home || normalizeHomePath("", user),
      sessionId: this.sessionId,
    };
  }

  assertAdminOperation(action, context = {}) {
    const principal = context.principal || this.permissions.principal({ user: this.session.user, groups: this.session.groups });
    if (principal.system || principal.user === "root" || (principal.groups || []).includes("admins")) {
      this.auditSecurity(action, "allowed", { principal, target: context.target || "" });
      return true;
    }
    this.auditSecurity(action, "denied", { principal, target: context.target || "", reason: "admin-required" });
    throw new Error(`${action}: denied: administrator required`);
  }

  auditSecurity(action, decision, details = {}) {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/var", "root", system);
    this.ensureSystemDirectory("/var/log", "root", system);
    this.ensureSystemDirectory("/var/log/dindbos", "root", system);
    const principal = details.principal || {};
    const entry = {
      at: new Date().toISOString(),
      action: String(action || "security"),
      decision: String(decision || "recorded"),
      user: String(principal.user || this.session.user || "guest"),
      groups: [...(principal.groups || [])],
      target: String(details.target || ""),
      reason: String(details.reason || ""),
    };
    const line = `${entry.at} action=${entry.action} decision=${entry.decision} user=${entry.user} groups=${entry.groups.join(",") || "-"} target=${entry.target || "-"}${entry.reason ? ` reason=${entry.reason}` : ""}\n`;
    const path = "/var/log/dindbos/security-audit.log";
    if (this.fs.exists(path)) this.fs.appendFile(path, line, "/", system);
    else this.fs.writeOrCreateFile(path, line, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "text/plain",
    }, system);
    return entry;
  }

  auditDeniedFileSystemAccess(event = {}) {
    const principal = event.principal || {};
    if (principal.system || principal.user === "root") return null;
    return this.auditSecurity(`fs-access:${event.access || "unknown"}`, "denied", {
      principal,
      target: event.path || "",
      reason: event.reason || "permission-denied",
    });
  }

  companionPermissions() {
    if (!this.fs.exists(COMPANION_PERMISSIONS_PATH)) return { version: 1, updatedAt: "", companions: {} };
    const parsed = safeJson(this.fs.readFile(COMPANION_PERMISSIONS_PATH, "/", this.permissions.systemPrincipal()), null);
    if (!parsed || parsed.version !== 1 || !parsed.companions || typeof parsed.companions !== "object") {
      return { version: 1, updatedAt: "", companions: {} };
    }
    const companions = {};
    Object.entries(parsed.companions).forEach(([key, value]) => {
      const identity = sanitizeIdentifier(value?.identity || key, "");
      if (!identity) return;
      companions[identity] = normalizeCompanionPermission(identity, value);
    });
    return {
      version: 1,
      updatedAt: String(parsed.updatedAt || ""),
      companions,
    };
  }

  listCompanionPermissions() {
    const permissions = this.companionPermissions();
    let changed = false;
    Object.values(permissions.companions).forEach((record) => {
      changed = this.ensureCompanionSessionObject(record) || changed;
    });
    const source = changed ? this.writeCompanionPermissions(permissions).companions : permissions.companions;
    return Object.values(source)
      .sort((left, right) => left.identity.localeCompare(right.identity))
      .map((entry) => ({ ...entry, capabilities: [...entry.capabilities] }));
  }

  companionPermissionStatus(identity) {
    const id = sanitizeIdentifier(identity, "");
    if (!id) return null;
    const permissions = this.companionPermissions();
    let record = permissions.companions[id] || null;
    if (record && this.ensureCompanionSessionObject(record)) {
      record = this.writeCompanionPermissions(permissions).companions[id] || record;
    }
    if (!record) return null;
    if (this.isSafeBootDisabled("companions")) {
      this.recordSafeBootDecision("companion-status", id, "blocked", "safe boot companion-disabled masks companion approval");
      return {
        ...record,
        approved: false,
        capabilities: [...record.capabilities],
        safeBootBlocked: true,
        safeBootProfile: this.activeSafeBootProfileId,
      };
    }
    return { ...record, capabilities: [...record.capabilities] };
  }

  grantCompanionPermission(identity, protocolVersion, capabilities = [], context = {}) {
    const id = sanitizeIdentifier(identity, "");
    if (!id) throw new Error("companion: identity is required");
    const protocol = String(protocolVersion || "").trim();
    if (!protocol) throw new Error("companion: protocol version is required");
    this.assertSafeBootAllows("companions", "companion-grant", id);
    this.assertAdminOperation("companion-permission:grant", { principal: context.principal, target: id });
    const permissions = this.companionPermissions();
    this.revokeCompanionSessionObject(permissions.companions[id], "companion-permission-regrant");
    permissions.companions[id] = normalizeCompanionPermission(id, {
      identity: id,
      protocolVersion: protocol,
      capabilities,
      approved: true,
      grantedBy: context.principal?.user || this.session.user || "guest",
      grantedAt: new Date().toISOString(),
      revokedAt: "",
    });
    this.ensureCompanionSessionObject(permissions.companions[id]);
    return this.writeCompanionPermissions(permissions).companions[id];
  }

  revokeCompanionPermission(identity, context = {}) {
    const id = sanitizeIdentifier(identity, "");
    if (!id) throw new Error("companion: identity is required");
    this.assertAdminOperation("companion-permission:revoke", { principal: context.principal, target: id });
    const permissions = this.companionPermissions();
    const existing = permissions.companions[id] || normalizeCompanionPermission(id, { identity: id });
    this.revokeCompanionSessionObject(existing, "companion-permission-revoked");
    permissions.companions[id] = {
      ...existing,
      approved: false,
      objectId: "",
      handleId: "",
      revokedBy: context.principal?.user || this.session.user || "guest",
      revokedAt: new Date().toISOString(),
    };
    return this.writeCompanionPermissions(permissions).companions[id];
  }

  isCompanionApproved(identity, protocolVersion = "", capability = "") {
    const record = this.companionPermissionStatus(identity);
    if (!record || !record.approved) return false;
    if (protocolVersion && record.protocolVersion !== String(protocolVersion || "").trim()) return false;
    if (capability && !hasCompanionCapability(record.capabilities, capability)) return false;
    const rights = capability ? [String(capability || "").trim().toLowerCase()] : ["connect"];
    return Boolean(this.assertCompanionSessionHandle(record, rights));
  }

  ensureCompanionSessionObject(record) {
    if (!record?.approved || !this.objects) return false;
    let changed = false;
    let object = record.objectId ? this.objects.get(record.objectId) : null;
    if (object?.status === "revoked") object = null;
    if (!object) {
      record.objectId = "";
      record.handleId = "";
      object = this.objects.register("companion-session", {
        ref: `companion:${record.identity}:${record.protocolVersion}`,
        name: record.identity,
        ownerPid: 0,
        user: "root",
        rights: companionSessionRights(record),
        metadata: companionSessionMetadata(record),
      });
      record.objectId = object?.id || "";
      changed = true;
    } else {
      this.objects.update(object.id, {
        rights: companionSessionRights(record),
        metadata: companionSessionMetadata(record),
      });
    }
    if (!record.handleId && record.objectId) {
      const handle = this.objects.createHandle(record.objectId, {
        ownerPid: 0,
        user: "root",
        groups: ["root"],
        rights: companionSessionRights(record),
        closeOnExec: false,
        transferPolicy: "none",
        metadata: companionSessionHandleMetadata(record),
      });
      record.handleId = handle?.id || "";
      changed = true;
    } else if (record.handleId) {
      try {
        this.objects.assertHandle(record.handleId, {
          ownerPid: 0,
          objectType: "companion-session",
          rights: ["connect"],
        });
        this.objects.updateHandle(record.handleId, {
          rights: companionSessionRights(record),
          metadata: companionSessionHandleMetadata(record),
        });
      } catch {
        if (!object) record.handleId = "";
      }
    }
    return changed;
  }

  assertCompanionSessionHandle(record = {}, rights = []) {
    if (!record.handleId || !this.objects) return null;
    try {
      return this.objects.assertHandle(record.handleId, {
        ownerPid: 0,
        objectType: "companion-session",
        rights,
      });
    } catch {
      return null;
    }
  }

  revokeCompanionSessionObject(record, reason = "companion-session-revoked") {
    if (!record || !this.objects) return null;
    if (record.objectId) return this.objects.revoke(record.objectId, reason);
    if (record.handleId) return this.objects.revokeHandle(record.handleId, reason);
    return null;
  }

  writeCompanionPermissions(record) {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/etc", "root", system);
    this.ensureSystemDirectory("/etc/dindbos", "root", system);
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      companions: {},
    };
    Object.entries(record.companions || {}).forEach(([key, value]) => {
      const identity = sanitizeIdentifier(value?.identity || key, "");
      if (identity) payload.companions[identity] = normalizeCompanionPermission(identity, value);
    });
    this.fs.writeOrCreateFile(COMPANION_PERMISSIONS_PATH, `${JSON.stringify(payload, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    return payload;
  }

  packagePreferences(userName = this.session.user) {
    const user = sanitizeUserName(userName || this.session.user);
    const path = this.packagePreferencesPath(user);
    if (!this.fs.exists(path)) return { version: 1, user, updatedAt: "", packages: {} };
    const parsed = safeJson(this.fs.readFile(path, "/", this.permissions.systemPrincipal()), null);
    if (!parsed || parsed.version !== 1 || parsed.user !== user || !parsed.packages || typeof parsed.packages !== "object") {
      return { version: 1, user, updatedAt: "", packages: {} };
    }
    return {
      version: 1,
      user,
      updatedAt: String(parsed.updatedAt || ""),
      packages: JSON.parse(JSON.stringify(parsed.packages)),
    };
  }

  setPackagePreference(packageId, key, value, userName = this.session.user) {
    const user = sanitizeUserName(userName || this.session.user);
    const id = sanitizeIdentifier(packageId, "");
    const preferenceKey = sanitizeIdentifier(key, "");
    if (!id) throw new Error("package preference package id is required");
    if (!preferenceKey) throw new Error("package preference key is required");
    const record = this.packagePreferences(user);
    record.packages[id] = record.packages[id] || {};
    record.packages[id][preferenceKey] = normalizePreferenceValue(value);
    this.writePackagePreferences(record);
    return record.packages[id][preferenceKey];
  }

  removePackagePreference(packageId, key, userName = this.session.user) {
    const user = sanitizeUserName(userName || this.session.user);
    const id = sanitizeIdentifier(packageId, "");
    const preferenceKey = sanitizeIdentifier(key, "");
    const record = this.packagePreferences(user);
    const existed = Boolean(record.packages[id] && Object.hasOwn(record.packages[id], preferenceKey));
    if (record.packages[id]) {
      delete record.packages[id][preferenceKey];
      if (!Object.keys(record.packages[id]).length) delete record.packages[id];
    }
    this.writePackagePreferences(record);
    return existed;
  }

  writePackagePreferences(record) {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/var", "root", system);
    this.ensureSystemDirectory("/var/lib", "root", system);
    this.ensureSystemDirectory("/var/lib/dindbos", "root", system);
    this.ensureSystemDirectory(PACKAGE_PREFERENCES_DIR, "root", system);
    const payload = {
      version: 1,
      user: sanitizeUserName(record.user || this.session.user),
      updatedAt: new Date().toISOString(),
      packages: JSON.parse(JSON.stringify(record.packages || {})),
    };
    this.fs.writeOrCreateFile(this.packagePreferencesPath(payload.user), `${JSON.stringify(payload, null, 2)}\n`, "/", {
      owner: payload.user,
      group: "users",
      permissions: "-rw-------",
      mime: "application/json",
    }, system);
    return payload;
  }

  packagePreferencesPath(userName = this.session.user) {
    const user = encodeURIComponent(sanitizeUserName(userName || this.session.user));
    return `${PACKAGE_PREFERENCES_DIR}/${user && user !== "." && user !== ".." ? user : "guest"}.json`;
  }

  sessionStatus() {
    return {
      instanceId: this.instanceId,
      sessionId: this.sessionId,
      user: this.session.user,
      groups: [...(this.session.groups || [])],
      home: this.session.home,
      state: this.sessionAuth.state,
      locked: this.sessionAuth.locked,
      lockedAt: this.sessionAuth.lockedAt,
      unlockedAt: this.sessionAuth.unlockedAt,
      reason: this.sessionAuth.reason,
      authMethod: this.sessionAuth.authMethod,
      loggedOutAt: this.sessionAuth.loggedOutAt,
      lastLoginAt: this.sessionAuth.lastLoginAt,
      authenticationPolicy: this.authenticationPolicy(),
      coordination: this.sessionCoordinationStatus(),
    };
  }

  authenticationPolicy() {
    return {
      mode: "browser-native-placeholder",
      loginMethods: ["session-placeholder"],
      password: {
        supported: false,
        status: "placeholder",
        reason: "Password verification is not implemented until a credential store and trusted login UI exist.",
      },
      passkey: {
        supported: false,
        status: "placeholder",
        reason: "Passkey login is reserved for a future WebAuthn-backed trusted login flow.",
      },
      guestReset: {
        supported: true,
        user: "guest",
      },
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
      this.storage.writeValue?.(this.sessionLockStorageKey, JSON.stringify(record));
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
    const raw = await this.storage.readValue?.(this.sessionLockStorageKey);
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
    let raw = this.memoryOnly ? this.operationLocks.get(key) : this.storage.readValueSync?.(key);
    try { if (!this.memoryOnly && !raw) raw = globalThis.localStorage?.getItem?.(key); } catch { /* Use adapter storage when browser storage is denied. */ }
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
    if (this.memoryOnly) { this.operationLocks.set(key, payload); return; }
    this.storage.writeValue?.(key, payload);
    try {
      globalThis.localStorage?.setItem?.(key, payload);
    } catch {}
  }

  removeRuntimeOperationLock(key) {
    if (this.memoryOnly) { this.operationLocks.delete(key); return; }
    this.storage.removeValue?.(key);
    try {
      globalThis.localStorage?.removeItem?.(key);
    } catch {}
  }

  operationLockKey(name) {
    return `${OPERATION_LOCK_PREFIX}${String(name || "runtime")}${this.coordinationSuffix}`;
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
    if (this.sessionAuth.state === "logged-out") throw new Error(`session: ${this.session.user}: logged out; login required`);
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

  logoutSession(reason = "manual") {
    Object.assign(this.sessionAuth, {
      state: "logged-out",
      locked: true,
      lockedAt: new Date().toISOString(),
      loggedOutAt: new Date().toISOString(),
      authMethod: "",
      reason: String(reason || "manual"),
    });
    this.writeSessionStatus();
    this.bus.emit("session:logout", this.sessionStatus());
    return this.sessionStatus();
  }

  loginSessionUser(userName, options = {}) {
    const method = String(options.method || "session-placeholder");
    if (method === "password") throw new Error("login: password auth is a placeholder in this browser runtime");
    if (method === "passkey") throw new Error("login: passkey auth is a placeholder until WebAuthn trusted login is implemented");
    if (method !== "session-placeholder") throw new Error(`login: unsupported auth method: ${method}`);
    const status = this.switchSessionUser(userName, { sessionId: options.sessionId });
    Object.assign(this.sessionAuth, {
      state: "authenticated",
      locked: false,
      lockedAt: "",
      unlockedAt: new Date().toISOString(),
      loggedOutAt: "",
      authMethod: method,
      lastLoginAt: new Date().toISOString(),
      reason: "",
    });
    this.writeSessionStatus();
    this.bus.emit("session:login", this.sessionStatus());
    return this.sessionStatus();
  }

  resetGuestSession(context = {}) {
    const principal = context.principal || this.permissions.principal({ user: this.session.user, groups: this.session.groups });
    if (principal.user !== "guest") this.assertAdminOperation("session:guest-reset", { principal, target: "guest" });
    const system = this.permissions.systemPrincipal();
    const guestHome = "/home/guest";
    [
      guestHome,
      "/var/lib/dindbos/app-state/guest",
      "/var/lib/dindbos/shell-history/guest.json",
      "/var/lib/dindbos/package-preferences/guest.json",
    ].forEach((path) => {
      if (this.fs.exists(path)) this.fs.remove(path, "/", { recursive: true }, system);
    });
    this.cache.clearUser?.("guest");
    this.ensureUserHome("guest", "users", guestHome);
    this.auditSecurity("session:guest-reset", "allowed", { principal, target: "guest" });
    this.bus.emit("session:guest-reset", { user: "guest", by: principal.user || "guest" });
    return { user: "guest", home: guestHome, reset: true };
  }

  switchSessionUser(userName, options = {}) {
    const user = sanitizeUserName(userName);
    const database = this.userGroupDatabase();
    const record = database.users[user];
    if (!record) throw new Error(`session: ${user}: no such user`);
    this.session = normalizeSession({
      ...this.session,
      user,
      groups: record.groups?.length ? record.groups : ["users"],
      home: record.home || `/home/${user}`,
      locked: false,
      lockReason: "",
    });
    this.sessionId = String(options.sessionId || `${this.session.user}:${this.instanceId}:${Date.now().toString(36)}`);
    this.permissions = new PermissionPolicy({ defaultUser: this.session.user, defaultGroups: this.session.groups });
    this.cache.setUser?.(this.session.user);
    Object.assign(this.sessionAuth, {
      state: "authenticated",
      locked: false,
      unlockedAt: new Date().toISOString(),
      authMethod: options.authMethod || this.sessionAuth.authMethod || "session-placeholder",
      lastLoginAt: this.sessionAuth.lastLoginAt || new Date().toISOString(),
      reason: "",
    });
    this.ensureSessionHome();
    this.writeSessionStatus();
    this.writeSessionCoordinationStatus();
    this.bus.emit("session:switch", this.sessionStatus());
    return this.sessionStatus();
  }

  assertSessionUnlocked(action = "session") {
    if (!this.sessionAuth.locked && this.sessionAuth.state === "authenticated") return;
    if (this.sessionAuth.state === "logged-out") throw new Error(`${action}: session logged out for ${this.session.user}; login required`);
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

  browserCapabilityStatus() {
    const ledger = this.privacyLedgerStatus({ limit: 200 });
    const capabilities = BROWSER_CAPABILITY_PROBES.map((probe) => ({
      ...probe,
      available: browserApiAvailable(probe.api),
      permissioned: true,
      policy: "broker-required",
      userGestureRequired: browserCapabilityNeedsGesture(probe.id),
      accessCount: ledger.filter((entry) => entry.capability === probe.id).length,
      revoked: [...this.browserGrantRevocations.values()].filter((entry) => entry.capability === probe.id),
    }));
    return {
      service: "dindbos-browser-capabilities",
      runtime: "web",
      brokerRequired: true,
      supported: capabilities.filter((capability) => capability.available).length,
      total: capabilities.length,
      capabilities,
      updatedAt: new Date().toISOString(),
    };
  }

  browserBrokerStatus() {
    const capabilityStatus = this.browserCapabilityStatus();
    return {
      service: "dindbos-browser-brokers",
      brokerRequired: true,
      revokedGrants: [...this.browserGrantRevocations.values()].map((entry) => ({ ...entry })),
      requests: this.browserBrokerRequests.slice(-50).map((entry) => ({ ...entry })),
      ledgerEntries: this.privacyLedgerStatus({ limit: 50 }),
      capabilities: capabilityStatus.capabilities.map((capability) => ({
        id: capability.id,
        api: capability.api,
        broker: capability.broker,
        device: capability.device,
        available: capability.available,
        policy: capability.policy,
        userGestureRequired: capability.userGestureRequired,
        accessCount: capability.accessCount,
        revoked: capability.revoked.length,
      })),
      updatedAt: new Date().toISOString(),
    };
  }

  requestBrowserAccess(process = null, capability = "", options = {}) {
    const probe = this.browserCapabilityProbe(capability);
    this.assertBrowserCapability(process, probe.id);
    const operation = String(options.operation || "request");
    const userGestureRequired = browserCapabilityNeedsGesture(probe.id);
    const promptAuthorization = this.browserTrustedPromptAuthorization(process, probe, options);
    const wantsTrustedPrompt = Boolean(options.trustedPrompt || options.promptTrustedUi || options.prompt);
    const userGesture = Boolean(options.userGesture || options.userActivation || options.trustedEvent || promptAuthorization.authorized);
    const activation = {
      required: userGestureRequired,
      present: userGesture,
      source: promptAuthorization.authorized ? "trusted-prompt" : options.activationSource || options.source || "browser-broker",
    };
    let trustedPrompt = promptAuthorization.prompt;
    if (userGestureRequired && !userGesture && wantsTrustedPrompt) {
      trustedPrompt = this.trustedPrompts.create(process, {
        capability: probe.id,
        target: String(options.target || probe.device),
        message: options.message || browserTrustedPromptMessage(probe, operation),
        timeoutMs: options.timeoutMs,
      });
    }
    const invocation = userGestureRequired && !userGesture
      ? {
        status: trustedPrompt ? "pending-trusted-prompt" : "pending-user-gesture",
        detail: trustedPrompt
          ? "browser API requires a compositor-owned trusted prompt before invocation"
          : "browser API requires an explicit user gesture before invocation",
      }
      : invokeBrowserCapability(probe, operation, options);
    const result = invocation.status === "invoked" || invocation.status === "promise-pending"
      ? "brokered"
      : invocation.status === "pending-trusted-prompt" || invocation.status === "pending-user-gesture"
        ? invocation.status
        : probe.available ? "brokered" : "unavailable";
    const entry = this.recordPrivacyAccess({
      process,
      capability: probe.id,
      broker: probe.broker,
      device: probe.device,
      operation,
      source: options.source || "browser-broker",
      target: options.target || probe.device,
      bytes: Number(options.bytes || 0),
      result,
      expiresAt: options.expiresAt || "",
      userGestureRequired,
      userGesture,
      trustedPromptId: trustedPrompt?.id || "",
      trustedPromptStatus: trustedPrompt?.status || "",
    });
    const request = {
      id: entry.id,
      capability: probe.id,
      broker: probe.broker,
      device: probe.device,
      operation,
      result,
      activation,
      invocation,
      trustedPrompt: trustedPrompt ? {
        id: trustedPrompt.id,
        status: trustedPrompt.status,
        ownerPid: trustedPrompt.ownerPid,
        capability: trustedPrompt.capability,
        target: trustedPrompt.target,
        compositorSurfaceId: trustedPrompt.compositorSurfaceId,
        captureProtected: trustedPrompt.captureProtected,
      } : null,
      pid: process?.pid || 0,
      appId: process?.appId || "",
      requestedAt: entry.at,
    };
    this.browserBrokerRequests.push(request);
    this.browserBrokerRequests = this.browserBrokerRequests.slice(-100);
    this.writeBrowserBrokerProcfs();
    return {
      capability: probe.id,
      broker: probe.broker,
      device: probe.device,
      available: probe.available,
      status: result,
      userVisiblePermission: true,
      activation,
      invocation,
      ledgerId: entry.id,
      trustedPrompt: request.trustedPrompt,
    };
  }

  browserTrustedPromptAuthorization(process = null, probe = {}, options = {}) {
    const id = String(options.trustedPromptId || options.promptId || "").trim();
    if (!id) return { authorized: false, prompt: null };
    const prompt = this.trustedPrompts.get(id);
    if (!prompt) throw codedError("ENOENT", `browser broker: trusted prompt ${id}: no such prompt`);
    if (prompt.ownerPid !== Number(process?.pid || 0)) {
      throw codedError("EACCES", `browser broker: trusted prompt ${id}: owner mismatch`);
    }
    if (prompt.capability !== probe.id) {
      throw codedError("EACCES", `browser broker: trusted prompt ${id}: capability mismatch`);
    }
    const target = String(options.target || probe.device);
    if (prompt.target && prompt.target !== target) {
      throw codedError("EACCES", `browser broker: trusted prompt ${id}: target mismatch`);
    }
    if (prompt.status !== "granted") {
      throw codedError("EACCES", `browser broker: trusted prompt ${id}: ${prompt.status || "not granted"}`);
    }
    return { authorized: true, prompt };
  }

  readClipboard(process = null, options = {}) {
    this.assertBrowserCapability(process, "clipboard.read");
    const text = String(this.clipboard?.readText?.() ?? "");
    this.recordPrivacyAccess({
      process,
      capability: "clipboard.read",
      broker: "clipboard",
      device: "/dev/browser/clipboard",
      operation: "read",
      bytes: byteLength(text),
      source: options.source || "clipboard",
      target: options.target || "/dev/clipboard",
    });
    return { text, bytes: byteLength(text) };
  }

  writeClipboard(process = null, text = "", options = {}) {
    this.assertBrowserCapability(process, "clipboard.write");
    const value = String(text ?? "");
    const result = this.clipboard?.writeText?.(value) || { bytes: byteLength(value) };
    this.recordPrivacyAccess({
      process,
      capability: "clipboard.write",
      broker: "clipboard",
      device: "/dev/browser/clipboard",
      operation: "write",
      bytes: Number(result.bytes || byteLength(value)),
      source: options.source || "clipboard",
      target: options.target || "/dev/clipboard",
    });
    return { ...result, bytes: Number(result.bytes || byteLength(value)) };
  }

  assertBrowserCapability(process = null, capability = "") {
    const requested = String(capability || "").trim();
    if (!requested) throw codedError("EINVAL", "browser capability is required");
    const revoked = this.browserGrantRevocationFor(process, requested);
    if (revoked) throw codedError("EACCES", `browser broker: ${requested}: grant revoked`);
    const capabilities = [
      ...(process?.manifest?.capabilities || []),
      ...(process?.manifest?.permissions?.capabilities || []),
    ].map(String);
    if (capabilities.includes(requested)) return true;
    throw codedError("EACCES", `browser broker: ${requested}: capability denied`);
  }

  browserCapabilityProbe(capability = "") {
    const requested = String(capability || "").trim();
    const probe = BROWSER_CAPABILITY_PROBES.find((entry) => entry.id === requested);
    if (!probe) throw codedError("ENODEV", `browser broker: ${requested}: unknown capability`);
    return { ...probe, available: browserApiAvailable(probe.api) };
  }

  revokeBrowserGrant(capability = "", options = {}) {
    const probe = this.browserCapabilityProbe(capability);
    const process = options.process || null;
    const pid = Number(options.pid || process?.pid || 0);
    const appId = String(options.appId || process?.appId || "");
    const key = browserGrantRevocationKey({ pid, appId, capability: probe.id });
    const record = {
      key,
      capability: probe.id,
      broker: probe.broker,
      device: probe.device,
      pid,
      appId,
      revokedBy: String(options.revokedBy || options.principal?.user || "system"),
      reason: String(options.reason || "revoked"),
      revokedAt: new Date().toISOString(),
    };
    this.browserGrantRevocations.set(key, record);
    this.recordPrivacyAccess({
      process: process || { pid, appId, user: options.principal?.user || this.session?.user || "guest" },
      capability: probe.id,
      broker: probe.broker,
      device: probe.device,
      operation: "revoke",
      source: "browser-broker",
      target: probe.device,
      result: "revoked",
    });
    this.writeBrowserDeviceProcfs("browser-grant-revoke");
    return { ...record };
  }

  browserGrantRevocationFor(process = null, capability = "") {
    const pid = Number(process?.pid || 0);
    const appId = String(process?.appId || "");
    return this.browserGrantRevocations.get(browserGrantRevocationKey({ pid, appId, capability }))
      || this.browserGrantRevocations.get(browserGrantRevocationKey({ pid: 0, appId, capability }))
      || this.browserGrantRevocations.get(browserGrantRevocationKey({ pid, appId: "", capability }))
      || null;
  }

  recordPrivacyAccess(event = {}) {
    const process = event.process || {};
    const entry = {
      id: `privacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      capability: String(event.capability || ""),
      broker: String(event.broker || ""),
      device: String(event.device || ""),
      operation: String(event.operation || ""),
      source: String(event.source || ""),
      target: String(event.target || ""),
      bytes: Number(event.bytes || 0),
      result: String(event.result || "ok"),
      pid: Number(process.pid || 0),
      appId: String(process.appId || ""),
      packageId: String(process.manifest?.namespace?.packageId || ""),
      user: String(process.user || this.session?.user || "guest"),
      windowId: String(event.windowId || process.windowId || ""),
      expiresAt: String(event.expiresAt || ""),
      userGestureRequired: Boolean(event.userGestureRequired),
      userGesture: Boolean(event.userGesture),
      trustedPromptId: String(event.trustedPromptId || ""),
      trustedPromptStatus: String(event.trustedPromptStatus || ""),
    };
    this.privacyLedger.push(entry);
    this.writePrivacyLedgerProcfs();
    this.writeBrowserBrokerProcfs();
    return { ...entry };
  }

  privacyLedgerStatus(filters = {}) {
    const limit = Math.max(1, Math.min(200, Number(filters.limit || 100)));
    return this.privacyLedger
      .filter((entry) => filters.capability === undefined || entry.capability === String(filters.capability || ""))
      .filter((entry) => filters.pid === undefined || entry.pid === Number(filters.pid || 0))
      .slice(-limit)
      .map((entry) => ({ ...entry }));
  }

  writePrivacyLedgerProcfs() {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/proc", "root", system);
    this.ensureSystemDirectory("/var", "root", system);
    this.ensureSystemDirectory("/var/log", "root", system);
    this.ensureSystemDirectory("/var/log/dindbos", "root", system);
    const entries = this.privacyLedgerStatus({ limit: 200 });
    const payload = `${JSON.stringify({
      service: "dindbos-privacy-ledger",
      count: entries.length,
      entries,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`;
    this.fs.writeOrCreateFile("/proc/privacy-ledger.json", payload, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/var/log/dindbos/privacy-ledger.jsonl", `${entries.map((entry) => JSON.stringify(entry)).join("\n")}${entries.length ? "\n" : ""}`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/jsonl",
    }, system);
    return entries;
  }

  deviceTreeStatus() {
    const capabilityStatus = this.browserCapabilityStatus();
    const devices = [...new Map(capabilityStatus.capabilities.map((capability) => [capability.device, capability])).keys()]
      .map((path) => {
        const capabilities = capabilityStatus.capabilities.filter((capability) => capability.device === path);
        return {
          path,
          type: "browser-api",
          driver: `${capabilities[0]?.broker || "browser"}-broker`,
          status: capabilities.some((capability) => capability.available) ? "available" : "unavailable",
          capabilities: capabilities.map((capability) => capability.id),
          apis: capabilities.map((capability) => ({
            id: capability.id,
            api: capability.api,
            available: capability.available,
          })),
        };
      });
    return {
      service: "dindbos-device-tree",
      root: "/dev/browser",
      devices,
      updatedAt: new Date().toISOString(),
    };
  }

  writeBrowserDeviceProcfs(reason = "browser-device-procfs") {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/proc", "root", system);
    this.ensureSystemDirectory("/dev", "root", system);
    this.ensureSystemDirectory("/dev/browser", "root", system);
    const capabilityStatus = { ...this.browserCapabilityStatus(), reason: String(reason || "browser-device-procfs") };
    const deviceTree = { ...this.deviceTreeStatus(), reason: String(reason || "browser-device-procfs") };
    this.fs.writeOrCreateFile("/proc/browser-capabilities", `${formatBrowserCapabilities(capabilityStatus.capabilities)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "text/plain",
    }, system);
    this.fs.writeOrCreateFile("/proc/browser-capabilities.json", `${JSON.stringify(capabilityStatus, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/proc/device-tree", `${formatDeviceTree(deviceTree.devices)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "text/plain",
    }, system);
    this.fs.writeOrCreateFile("/proc/device-tree.json", `${JSON.stringify(deviceTree, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "application/json",
    }, system);
    this.writeBrowserBrokerProcfs(system);
    return { capabilities: capabilityStatus, deviceTree };
  }

  writeBrowserBrokerProcfs(system = this.permissions.systemPrincipal()) {
    this.ensureSystemDirectory("/proc", "root", system);
    this.fs.writeOrCreateFile("/proc/browser-brokers.json", `${JSON.stringify(this.browserBrokerStatus(), null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "application/json",
    }, system);
    return this.browserBrokerStatus();
  }

  compatibilitySnapshot() {
    return compatibilitySnapshot(this);
  }

  conformanceReport() {
    return conformanceReport(this);
  }

  conformanceEvidenceRecords() {
    return this.conformanceEvidence.map((record) => ({ ...record, categories: [...record.categories], artifacts: [...record.artifacts] }));
  }

  addConformanceEvidence(record = {}) {
    const normalized = normalizeConformanceEvidenceRecord(record);
    this.conformanceEvidence = [
      normalized,
      ...this.conformanceEvidence.filter((entry) => entry.id !== normalized.id),
    ].slice(0, 200);
    this.writeConformanceEvidenceProcfs("evidence-added");
    this.writeConformanceProcfs("evidence-added");
    return { ...normalized, categories: [...normalized.categories], artifacts: [...normalized.artifacts] };
  }

  writeConformanceEvidenceProcfs(reason = "conformance-evidence") {
    if (!this.fs?.exists?.("/proc")) return null;
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/var", "root", system);
    this.ensureSystemDirectory("/var/run", "root", system);
    this.ensureSystemDirectory("/var/run/dindbos", "root", system);
    this.ensureSystemDirectory("/proc", "root", system);
    const payload = {
      service: "dindbos-conformance-evidence",
      version: 1,
      reason: String(reason || "conformance-evidence"),
      updatedAt: new Date().toISOString(),
      count: this.conformanceEvidence.length,
      records: this.conformanceEvidenceRecords(),
    };
    this.fs.writeOrCreateFile(CONFORMANCE_EVIDENCE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/proc/conformance-evidence.json", `${JSON.stringify(payload, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/proc/conformance-evidence", `${formatConformanceEvidence(payload)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "text/plain",
    }, system);
    return payload;
  }

  writeConformanceProcfs(reason = "conformance") {
    if (!this.fs?.exists?.("/proc")) return null;
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/proc", "root", system);
    const report = {
      ...this.conformanceReport(),
      reason: String(reason || "conformance"),
    };
    this.fs.writeOrCreateFile("/proc/conformance.json", `${JSON.stringify(report, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/proc/conformance", `${formatConformanceReport(report)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "text/plain",
    }, system);
    this.writeConformanceEvidenceProcfs(reason);
    return report;
  }

  isolationStatus() {
    const status = isolationSnapshot(this.compatibilitySnapshot().browser || {});
    return {
      ...status,
      memoryRegions: this.workerMemoryRegionStatus(),
    };
  }

  createWorkerMemoryRegion(options = {}) {
    const size = Number(options.size || options.bytes || 0);
    if (!Number.isInteger(size) || size <= 0) throw new Error("memory-region: size must be a positive integer");
    const isolation = this.isolationStatus();
    const maxRegionBytes = Number(isolation.workerMemory?.maxRegionBytes || 16 * 1024 * 1024);
    if (size > maxRegionBytes) throw new Error(`memory-region: size ${size} exceeds limit ${maxRegionBytes}`);
    const shared = Boolean(isolation.sharedMemory?.available);
    if (!shared && options.allowFallback === false) throw new Error("memory-region: SharedArrayBuffer requires cross-origin isolation");
    const buffer = shared ? new SharedArrayBuffer(size) : new ArrayBuffer(size);
    const id = String(options.id || `wmr-${Date.now().toString(36)}-${this.workerMemoryRegions.size + 1}`);
    const object = this.objects?.register?.("memory-region", {
      ref: `memory-region:${id}`,
      name: String(options.name || id),
      ownerPid: Number(options.ownerPid || 0),
      user: this.session.user,
      rights: ["read", "write", "transfer"],
      metadata: {
        bytes: size,
        shared,
        backing: shared ? "SharedArrayBuffer" : "ArrayBuffer",
        isolation: isolation.current,
        degraded: !shared,
      },
    });
    const handle = object?.id ? this.objects.createHandle(object.id, {
      ownerPid: Number(options.ownerPid || 0),
      user: this.session.user,
      groups: this.session.groups,
      rights: ["read", "write", "transfer"],
      transferPolicy: "duplicate",
      metadata: {
        regionId: id,
        bytes: size,
        shared,
      },
    }) : null;
    const record = {
      id,
      objectId: object?.id || "",
      handleId: handle?.id || "",
      bytes: size,
      shared,
      backing: shared ? "SharedArrayBuffer" : "ArrayBuffer",
      transfer: shared ? "shared-memory" : "copy-fallback",
      degraded: !shared,
      isolation: isolation.current,
      createdAt: new Date().toISOString(),
      buffer,
    };
    this.workerMemoryRegions.set(id, record);
    this.writeIsolationProcfs("memory-region-create");
    return { ...record };
  }

  workerMemoryRegionStatus() {
    return [...this.workerMemoryRegions.values()].map(({ buffer, ...record }) => ({ ...record }));
  }

  writeIsolationProcfs(reason = "isolation") {
    if (!this.fs.exists("/proc")) return this.isolationStatus();
    const system = this.permissions.systemPrincipal();
    const status = {
      ...this.isolationStatus(),
      reason: String(reason || "isolation"),
      updatedAt: new Date().toISOString(),
    };
    this.fs.writeOrCreateFile("/proc/isolation.json", `${JSON.stringify(status, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/proc/isolation", `${formatIsolationStatus(status)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-r--r--r--",
      mime: "text/plain",
    }, system);
    return status;
  }

  syscall(name, args = {}, context = {}) {
    const principal = context.principal || this.permissions.principal({ user: this.session.user, groups: this.session.groups });
    return this.syscalls.call(name, args, { ...context, principal });
  }

  syscallAsync(name, args = {}, context = {}) {
    const principal = context.principal || this.permissions.principal({ user: this.session.user, groups: this.session.groups });
    return this.syscalls.callAsync(name, args, { ...context, principal });
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
    if (this.destroyed) throw new Error("Cannot register an app after runtime destruction");
    const registered = this.apps.register(app);
    if (this.shell.refs.dock) this.shell.renderDock();
    if (this.shell.refs.desktop) this.shell.renderDesktop();
    return registered;
  }

  unregisterApp(appId) {
    const removed = this.apps.unregister(appId);
    if (removed && this.shell.refs.dock) this.shell.renderDock();
    if (removed && this.shell.refs.desktop) this.shell.renderDesktop();
    return removed;
  }

  launch(appId, context = {}) {
    this.assertSessionUnlocked("launch");
    const manifest = this.apps.getManifest(appId);
    if (manifest?.namespace?.packageId) this.assertSafeBootAllows("packages", "app-launch", appId);
    if (this.isSafeBootDisabled("app-autostart") && context.autostart) this.assertSafeBootAllows("app-autostart", "app-autostart", appId);
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
      objectId: "",
      handleId: "",
      handler,
      createdAt: new Date().toISOString(),
    };
    this.registerIpcKernelObject(record, process);
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
    this.assertIpcEndpointHandle(record);
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
      this.revokeIpcKernelObject(record, reason);
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
      this.revokeIpcKernelObject(record, reason);
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

  registerIpcKernelObject(record, process = null) {
    const object = this.objects?.register?.("ipc", {
      ref: `ipc:${record.endpoint}`,
      name: record.endpoint,
      ownerPid: record.ownerPid,
      namespace: process?.manifest?.namespace || null,
      user: process?.user || this.session.user || "",
      rights: ["inspect", "receive", "send", "close"],
      metadata: ipcObjectMetadata(record),
    }) || null;
    record.objectId = object?.id || "";
    const handle = record.objectId ? this.objects?.createHandle?.(record.objectId, {
      ownerPid: record.ownerPid,
      user: process?.user || this.session.user || "",
      uid: process?.uid || 0,
      gid: process?.gid || 0,
      groups: process?.groups || [],
      namespace: process?.manifest?.namespace || null,
      rights: ["inspect", "receive", "close"],
      closeOnExec: true,
      transferPolicy: "no-duplicate",
      metadata: ipcHandleMetadata(record),
    }) : null;
    record.handleId = handle?.id || "";
    return publicIpcEndpoint(record);
  }

  assertIpcEndpointHandle(record) {
    if (!record?.handleId) return null;
    try {
      return this.objects?.assertHandle?.(record.handleId, {
        ownerPid: record.ownerPid,
        objectType: "ipc",
        rights: ["receive"],
      }) || null;
    } catch (error) {
      throw codedError(error.code || "EACCES", error.message);
    }
  }

  revokeIpcKernelObject(record, reason = "ipc-unregister") {
    if (!record?.objectId) return null;
    return this.objects?.revoke?.(record.objectId, reason) || null;
  }

  persistFileSystem() {
    this.storage.saveFileSystem(this.fs.snapshot());
  }

  schedulePersistFileSystem(event = {}) {
    if (this.destroyed) return;
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
      this.flushPersistentFileSystem().catch(() => {}); // Error status is published; dirty data remains retryable.
      return;
    }
    if (this.persistTimer) {
      this.persistenceStats.coalesced += 1;
      return;
    }
    this.persistTimer = globalThis.setTimeout(() => {
      this.persistTimer = null;
      this.flushPersistentFileSystem().catch(() => {}); // Error status is published; dirty data remains retryable.
    }, this.persistDelayMs);
  }

  flushPersistentFileSystem() {
    if (this.persistTimer) {
      globalThis.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.persisting) {
      this.persistRequestedDuringFlush = true;
      return this.persistFlushPromise;
    }
    // Publish the shared promise before start listeners can request another flush.
    let resolveFlush, rejectFlush;
    const pending = new Promise((resolve, reject) => { resolveFlush = resolve; rejectFlush = reject; });
    this.persistFlushPromise = pending;
    this.performPersistentFileSystemFlush().then(resolveFlush, rejectFlush);
    return pending;
  }

  async performPersistentFileSystemFlush() {
    this.persisting = true;
    const startedAt = Date.now();
    const group = this.storageTransactions?.beginGroup?.("writeback-flush", {
      metadata: {
        pending: Boolean(this.persistPending),
        scheduled: this.persistenceStats.scheduled,
        reason: this.persistenceStats.lastAction || "flush",
      },
    }) || null;
    const transaction = this.storageTransactions?.begin?.("persistence-flush", {
      groupId: group?.id || "",
      metadata: {
        pending: Boolean(this.persistPending),
        scheduled: this.persistenceStats.scheduled,
        coalesced: this.persistenceStats.coalesced,
        lastAction: this.persistenceStats.lastAction,
        lastPath: this.persistenceStats.lastPath,
      },
    }) || null;
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
      this.persistPending = true;
      if (transaction?.id) this.storageTransactions?.fail?.(transaction.id, error, {
        metadata: {
          flushed: this.persistenceStats.flushed,
          durationMs: Date.now() - startedAt,
        },
      });
      this.persistenceStats.lastFlushError = error?.message || String(error);
      throw error;
    } finally {
      if (!failure && transaction?.id) this.storageTransactions?.commit?.(transaction.id, {
        metadata: {
          flushed: this.persistenceStats.flushed,
          durationMs: Date.now() - startedAt,
        },
      });
      if (failure && group?.id) this.storageTransactions?.failGroup?.(group.id, failure, {
        metadata: {
          flushed: this.persistenceStats.flushed,
          durationMs: Date.now() - startedAt,
        },
      });
      if (!failure && group?.id) this.storageTransactions?.commitGroup?.(group.id, {
        metadata: {
          flushed: this.persistenceStats.flushed,
          durationMs: Date.now() - startedAt,
        },
      });
      this.persisting = false;
      this.persistenceStats.lastFlushDurationMs = Date.now() - startedAt;
      this.publishSessionStorageFlush(failure ? "error" : "complete", { error: this.persistenceStats.lastFlushError });
      this.writeStorageKernelProcfs(failure ? "flush-error" : "flush-complete");
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
      storageTransactions: this.storageTransactions?.status?.().slice(-20) || [],
      storageTransactionGroups: this.storageTransactions?.groupStatus?.().slice(-20) || [],
    };
  }

  storageKernelStatus(reason = "status") {
    const storage = safeRead(() => this.storage.status(), {});
    const persistence = this.persistenceStatus();
    const transactions = this.storageTransactions?.status?.().slice(-25) || [];
    const transactionGroups = this.storageTransactions?.groupStatus?.().slice(-25) || [];
    const localMountConflicts = safeRead(() => this.localMounts?.conflictStatus?.(), []);
    const remoteConflicts = safeRead(() => this.listRemoteSyncConflicts?.(), []);
    const recovery = safeRead(() => this.recoveryStatus?.(), null);
    const journal = safeRead(() => this.storage.journal?.().slice(-20), []);
    const pending = Boolean(
      storage.writePending
      || persistence.persistPending
      || persistence.persistInFlight
      || transactions.some((entry) => entry.status === "pending")
      || transactionGroups.some((entry) => entry.status === "pending"),
    );
    return {
      service: "dindbos-storage-kernel",
      reason: String(reason || "status"),
      updatedAt: new Date().toISOString(),
      state: pending ? "writeback-pending" : "idle",
      pageCache: {
        format: storage.storageFormat || "unknown",
        bytes: Number(storage.bytes || storage.usage || 0),
        inodeRecords: Number(storage.inodeRecords || 0),
        fileRecords: Number(storage.fileRecords || 0),
        contentBytes: Number(storage.contentBytes || 0),
        dirtyInodes: Number(storage.dirtyInodes || 0),
        dirtyFiles: Number(storage.dirtyFiles || 0),
        integrityMismatches: storage.storageIntegrityMismatches || [],
      },
      writeback: {
        backend: storage.backend || "memory",
        structuredBackend: storage.structuredBackend || "memory",
        pending,
        writePending: Boolean(storage.writePending),
        persistPending: Boolean(persistence.persistPending),
        persistInFlight: Boolean(persistence.persistInFlight),
        scheduled: Number(persistence.persistScheduled || 0),
        coalesced: Number(persistence.persistCoalesced || 0),
        flushes: Number(persistence.persistFlushes || 0),
        lastQueuedAt: storage.lastWriteQueuedAt || "",
        lastCompletedAt: storage.lastWriteCompletedAt || "",
        lastFlushStartedAt: persistence.persistLastFlushStartedAt || "",
        lastFlushedAt: persistence.persistLastFlushedAt || "",
        lastFlushDurationMs: Number(persistence.persistLastFlushDurationMs || 0),
        lastError: storage.lastWriteError || persistence.persistLastFlushError || "",
      },
      recovery: {
        lastDecision: storage.storageRecoveryDecision || null,
        lastRepair: this.lastStorageRepair,
        lastShutdown: recovery?.lastShutdown || null,
        lastRecovery: recovery?.lastRecovery || null,
      },
      conflicts: {
        localMounts: Array.isArray(localMountConflicts) ? localMountConflicts : [],
        remoteSync: Array.isArray(remoteConflicts) ? remoteConflicts : [],
      },
      transactions,
      transactionGroups,
      journal,
    };
  }

  writeStorageKernelProcfs(reason = "storage-kernel") {
    if (!this.fs?.exists?.("/proc")) return null;
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/proc", "root", system);
    const status = this.storageKernelStatus(reason);
    this.fs.writeOrCreateFile("/proc/storage-kernel.json", `${JSON.stringify(status, null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.fs.writeOrCreateFile("/proc/writeback", `${formatStorageWriteback(status)}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    return status;
  }

  async runStorageFsck(options = {}) {
    const repair = Boolean(options.repair);
    const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : !repair;
    let result = this.fs.checkIntegrity({ repair, dryRun });
    result = mergeFsckResults(result, safeRead(() => this.packages?.checkIntegrity?.({ repair, dryRun }), null));
    result = mergeFsckResults(result, await safeAsync(() => this.storage?.checkIntegrity?.({ repair, dryRun }), null));
    result = mergeFsckResults(result, await safeAsync(() => this.localMounts?.checkIntegrity?.({ repair, dryRun }), null));
    if (options.salvage) result = { ...result, salvage: this.shell?.writeFsckSalvageExport?.() || null };
    this.lastStorageRepair = {
      checkedAt: new Date().toISOString(),
      repair,
      dryRun,
      salvage: Boolean(options.salvage),
      ok: Boolean(result.ok),
      problems: Number(result.problemCount || 0),
      repairs: Number(result.repairCount || 0),
      result,
    };
    this.shell?.recordFsckLog?.(result);
    this.writeStorageKernelProcfs("fsck");
    return result;
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
      this.flushPersistentFileSystem().catch(() => {}); // Preserve dirty data and the published flush error for retry.
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
    this.listenLifecycle(globalThis.window, "pagehide", flush);
    this.listenLifecycle(globalThis.window, "beforeunload", flushBeforeUnload);
    this.listenLifecycle(globalThis.document, "visibilitychange", () => {
      if (globalThis.document.visibilityState === "hidden") flush();
    });
  }

  installServiceLifecycleHooks() {
    if (this.serviceLifecycleHooksInstalled || typeof globalThis.window === "undefined") return;
    this.serviceLifecycleHooksInstalled = true;
    const suspend = (reason) => {
      const group = this.storageTransactions?.beginGroup?.("service-lifecycle-suspend", {
        metadata: {
          reason,
          runningServices: safeRead(() => this.services?.list?.().filter((service) => service.state === "running").length, 0),
          pendingPersistence: this.hasPendingPersistenceWork(),
        },
      });
      this.transitionLifecycle("suspending", reason);
      try {
        this.services?.suspend?.(reason);
        this.transitionLifecycle("suspended", reason);
        if (reason === "pagehide") this.writeRecoveryRecord(reason);
        if (group?.id) this.storageTransactions?.commitGroup?.(group.id, {
          metadata: {
            suspendedServices: safeRead(() => this.services?.list?.().filter((service) => service.state === "suspended").length, 0),
          },
        });
      } catch (error) {
        if (group?.id) this.storageTransactions?.failGroup?.(group.id, error);
        throw error;
      } finally {
        this.writeStorageKernelProcfs("service-lifecycle-suspend");
      }
    };
    const resume = (reason) => {
      const group = this.storageTransactions?.beginGroup?.("service-lifecycle-resume", {
        metadata: {
          reason,
          suspendedServices: safeRead(() => this.services?.list?.().filter((service) => service.state === "suspended").length, 0),
        },
      });
      this.transitionLifecycle("resuming", reason);
      try {
        this.services?.resume?.(reason);
        this.transitionLifecycle("active", reason);
        if (group?.id) this.storageTransactions?.commitGroup?.(group.id, {
          metadata: {
            runningServices: safeRead(() => this.services?.list?.().filter((service) => service.state === "running").length, 0),
          },
        });
      } catch (error) {
        if (group?.id) this.storageTransactions?.failGroup?.(group.id, error);
        throw error;
      } finally {
        this.writeStorageKernelProcfs("service-lifecycle-resume");
      }
    };
    this.listenLifecycle(globalThis.window, "pagehide", () => suspend("pagehide"));
    this.listenLifecycle(globalThis.window, "pageshow", () => resume("pageshow"));
    this.listenLifecycle(globalThis.window, "beforeunload", () => {
      this.transitionLifecycle("shutting-down", "beforeunload");
      this.writeRecoveryRecord("beforeunload");
    });
    this.listenLifecycle(globalThis.document, "visibilitychange", () => {
      if (globalThis.document.visibilityState === "hidden") {
        suspend("visibility-hidden");
        return;
      }
      if (globalThis.document.visibilityState === "visible") resume("visibility-visible");
    });
  }

  listenLifecycle(target, type, listener) {
    target?.addEventListener?.(type, listener);
    this.lifecycleCleanups.push(() => target?.removeEventListener?.(type, listener));
  }

  setAppearance(patch = {}) {
    if (this.destroyed) return { ...this.appearance };
    this.appearance = normalizeAppearance(patch, this.appearance);
    applyAppearance(this.root, this.appearance, this.appearanceMedia?.matches);
    try { if (!this.memoryOnly) globalThis.localStorage?.setItem(this.appearanceStorageKey, JSON.stringify(this.appearance)); } catch { /* Keep the in-memory preference if storage is denied. */ }
    this.bus.emit("appearance:change", { ...this.appearance });
    return { ...this.appearance };
  }

  getUIStylePreference() {
    return { ...this.uiStylePreference };
  }

  setUIStylePreference(patch) {
    if (this.destroyed) return this.getUIStylePreference();
    this.uiStylePreference = normalizeUIStylePreference(patch, this.uiStylePreference);
    this.uiStyleSaveFailed = false;
    try { if (!this.memoryOnly) {
      if (!globalThis.localStorage) throw new Error("Browser storage is unavailable");
      globalThis.localStorage.setItem(this.uiStyleStorageKey, JSON.stringify(this.uiStylePreference));
    } } catch {
      this.uiStyleSaveFailed = true;
      this.shell?.notify("UI style changed for this session. Browser storage could not save it.");
    }
    this.bus.emit("ui:preference-change", this.getUIStylePreference());
    return this.getUIStylePreference();
  }

  destroy() {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyed = true;
    const errors = [];
    const clean = (action) => { try { action(); } catch (error) { errors.push(error); } };
    for (const cleanup of this.lifecycleCleanups.splice(0)) clean(cleanup);
    for (const record of this.services?.list?.() || []) {
      if (record.pid) clean(() => this.services.stop(record.id));
    }
    for (const process of this.processes?.list?.() || []) {
      if (this.processes.get(process.pid)) clean(() => this.processes.kill(process.pid, "runtime-destroyed"));
    }
    clean(() => this.windows?.destroy?.());
    clean(() => this.shell?.destroy?.());
    for (const session of this.network?.webSocketSessions?.values?.() || []) clean(() => session.socket?.close?.(1000, "Runtime destroyed"));
    for (const session of this.network?.dataChannelSessions?.values?.() || []) {
      clean(() => session.channel?.close?.());
      clean(() => session.peerConnection?.close?.());
    }
    for (const session of this.network?.rawSocketSessions?.values?.() || []) clean(() => session.companion?.closeRaw?.(session.record.companionSessionId, "runtime-destroyed"));
    clean(() => this.sessionChannel?.close?.());
    this.sessionChannel = null;
    this.sessionChannelStatus.connected = false;
    if (this.persistTimer) globalThis.clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (this.root && runtimeHosts.get(this.root) === this) {
      this.root.replaceChildren?.();
      runtimeHosts.delete(this.root);
    }
    this.destroyPromise = (async () => {
      try {
        if (this.persistPending || this.persisting) await this.flushPersistentFileSystem();
        else await this.storage?.flush?.();
      } catch (error) { errors.push(error); }
      try {
        const lock = await this.readSessionLock();
        if (lock?.owner === this.instanceId) {
          await this.storage.removeValue?.(this.sessionLockStorageKey);
          await this.storage.flush?.();
        }
      } catch (error) { errors.push(error); }
      this.bus.listeners.clear();
      if (errors.length) throw new AggregateError(errors, "DindbOS cleanup failed");
    })();
    return this.destroyPromise;
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

function safeRead(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

async function safeAsync(fn, fallback = null) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function mergeFsckResults(base = {}, extra = null) {
  if (!extra) return base || {};
  const problems = [...(base.problems || []), ...(extra.problems || [])];
  const repairs = [...(base.repairs || []), ...(extra.repairs || [])];
  return {
    ...base,
    ok: Boolean(base.ok) && Boolean(extra.ok),
    repaired: Boolean(base.repaired || extra.repaired),
    checkedNodes: Number(base.checkedNodes || 0) + Number(extra.checkedNodes || 0),
    checkedPackages: Number(base.checkedPackages || 0) + Number(extra.checkedPackages || 0),
    checkedStorage: Number(base.checkedStorage || 0) + Number(extra.checkedStorage || 0),
    checkedLocalMounts: Number(base.checkedLocalMounts || 0) + Number(extra.checkedLocalMounts || 0),
    problemCount: problems.length,
    repairCount: repairs.length,
    problems,
    repairs,
  };
}

function formatStorageWriteback(status = {}) {
  const writeback = status.writeback || {};
  const cache = status.pageCache || {};
  return [
    `state=${status.state || "unknown"}`,
    `backend=${writeback.backend || "memory"}`,
    `format=${cache.format || "unknown"}`,
    `pending=${Boolean(writeback.pending)}`,
    `dirtyInodes=${Number(cache.dirtyInodes || 0)}`,
    `dirtyFiles=${Number(cache.dirtyFiles || 0)}`,
    `flushes=${Number(writeback.flushes || 0)}`,
    `groups=${Number(status.transactionGroups?.length || 0)}`,
    `transactions=${Number(status.transactions?.length || 0)}`,
    `localConflicts=${Number(status.conflicts?.localMounts?.length || 0)}`,
    `remoteConflicts=${Number(status.conflicts?.remoteSync?.length || 0)}`,
    `lastError=${writeback.lastError || "-"}`,
  ].join("\n");
}

function sanitizeGroups(groups) {
  const values = Array.isArray(groups) ? groups : ["users"];
  const sanitized = values.map((group) => sanitizeIdentifier(group, "")).filter(Boolean);
  return sanitized.length ? [...new Set(sanitized)] : ["users"];
}

function sanitizeUserName(value) {
  return sanitizeIdentifier(value, "guest");
}

function normalizeUserGroupDatabase(database = {}) {
  const rawGroups = { root: { group: "root", gid: 0, members: ["root"] }, users: { group: "users", gid: 100, members: [] }, ...(database.groups || {}) };
  const groups = {};
  let nextGid = nextIdentityId(Object.values(rawGroups).map((entry) => entry?.gid), 1000);
  Object.entries(rawGroups).forEach(([key, value]) => {
    const group = sanitizeIdentifier(value?.group || key, "");
    if (!group) return;
    const gid = Number.isInteger(Number(value?.gid)) ? Number(value.gid) : gidForGroup(group, nextGid++);
    groups[group] = {
      ...value,
      group,
      gid,
      members: [...new Set((value?.members || []).map((member) => sanitizeUserName(member)).filter(Boolean))].sort(),
      createdAt: value?.createdAt || "",
    };
  });

  const rawUsers = { root: { user: "root", uid: 0, home: "/root", groups: ["root"] }, ...(database.users || {}) };
  const users = {};
  let nextUid = nextIdentityId(Object.values(rawUsers).map((entry) => entry?.uid), 1000);
  Object.entries(rawUsers).forEach(([key, value]) => {
    const user = sanitizeUserName(value?.user || key);
    const userGroups = sanitizeGroups(value?.groups?.length ? value.groups : [user === "root" ? "root" : "users"]);
    const uid = Number.isInteger(Number(value?.uid)) ? Number(value.uid) : uidForUser(user, nextUid++);
    users[user] = {
      ...value,
      user,
      uid,
      home: normalizeHomePath(value?.home, user),
      groups: userGroups,
      createdAt: value?.createdAt || "",
    };
    userGroups.forEach((group) => {
      groups[group] = groups[group] || { group, gid: gidForGroup(group, nextGid++), members: [], createdAt: "" };
      if (!groups[group].members.includes(user)) groups[group].members.push(user);
      groups[group].members.sort();
    });
  });

  return {
    users: Object.fromEntries(Object.entries(users).sort(([left], [right]) => left.localeCompare(right))),
    groups: Object.fromEntries(Object.entries(groups).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function uidForUser(user, fallback) {
  return WELL_KNOWN_USER_IDS[user] ?? fallback;
}

function gidForGroup(group, fallback) {
  return WELL_KNOWN_GROUP_IDS[group] ?? fallback;
}

function nextIdentityId(values, floor) {
  const used = values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= floor);
  return used.length ? Math.max(...used) + 1 : floor;
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizePreferenceValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && Number.isFinite(Number(value))) return Number(value);
  try {
    return JSON.parse(value);
  } catch {
    return String(value ?? "");
  }
}

function normalizeCompanionPermission(identity, value = {}) {
  return {
    identity,
    protocolVersion: String(value.protocolVersion || "").trim(),
    capabilities: normalizeCompanionCapabilities(value.capabilities),
    approved: Boolean(value.approved),
    objectId: String(value.objectId || ""),
    handleId: String(value.handleId || ""),
    grantedBy: String(value.grantedBy || ""),
    grantedAt: String(value.grantedAt || ""),
    revokedBy: String(value.revokedBy || ""),
    revokedAt: String(value.revokedAt || ""),
  };
}

function companionSessionRights(record = {}) {
  return [
    "connect",
    "inspect",
    ...normalizeCompanionCapabilities(record.capabilities).map((capability) => capability.toLowerCase()),
  ];
}

function companionSessionMetadata(record = {}) {
  return {
    identity: record.identity || "",
    protocolVersion: record.protocolVersion || "",
    capabilities: normalizeCompanionCapabilities(record.capabilities),
    approved: Boolean(record.approved),
    grantedBy: record.grantedBy || "",
    grantedAt: record.grantedAt || "",
  };
}

function companionSessionHandleMetadata(record = {}) {
  return {
    identity: record.identity || "",
    protocolVersion: record.protocolVersion || "",
    capabilities: normalizeCompanionCapabilities(record.capabilities),
  };
}

function normalizeCompanionCapabilities(capabilities) {
  return [...new Set((Array.isArray(capabilities) ? capabilities : String(capabilities || "").split(","))
    .map((capability) => String(capability || "").trim())
    .filter(Boolean))].sort();
}

function hasCompanionCapability(capabilities, capability) {
  const requested = String(capability || "").trim().toLowerCase();
  return normalizeCompanionCapabilities(capabilities).some((entry) => entry.toLowerCase() === requested);
}

function browserApiAvailable(path) {
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length) return false;
  let cursor = globalThis;
  for (const part of parts) {
    if (cursor == null || !(part in Object(cursor))) return false;
    cursor = cursor[part];
  }
  return typeof cursor === "function" || Boolean(cursor);
}

function browserCapabilityNeedsGesture(capability = "") {
  return [
    "notifications.show",
    "localFile.open",
    "localFile.save",
    "localDirectory.open",
    "screen.capture",
    "media.audioVideo",
    "webShare.share",
    "webusb.device",
    "webserial.port",
    "webhid.device",
  ].includes(String(capability || ""));
}

function invokeBrowserCapability(probe = {}, operation = "request", options = {}) {
  if (!probe.available) return { status: "unavailable", detail: `${probe.api} unavailable` };
  try {
    const payload = options.payload || {};
    let value = null;
    if (probe.id === "notifications.show") value = invokeNotificationBroker(operation, payload);
    else if (probe.id === "localFile.open") value = globalThis.showOpenFilePicker?.(payload.options || {});
    else if (probe.id === "localFile.save") value = globalThis.showSaveFilePicker?.(payload.options || {});
    else if (probe.id === "localDirectory.open") value = globalThis.showDirectoryPicker?.(payload.options || {});
    else if (probe.id === "screen.capture") value = globalThis.navigator?.mediaDevices?.getDisplayMedia?.(payload.constraints || { video: true });
    else if (probe.id === "media.audioVideo") value = globalThis.navigator?.mediaDevices?.getUserMedia?.(payload.constraints || { audio: true, video: true });
    else if (probe.id === "media.enumerate") value = globalThis.navigator?.mediaDevices?.enumerateDevices?.();
    else if (probe.id === "webShare.share") value = globalThis.navigator?.share?.(payload.share || { title: "DindbOS", text: "DindbOS brokered share" });
    else if (probe.id === "webrtc.peerConnection") value = typeof globalThis.RTCPeerConnection === "function" ? new globalThis.RTCPeerConnection(payload.configuration || {}) : null;
    else if (probe.id === "webgpu.adapter") value = globalThis.navigator?.gpu?.requestAdapter?.(payload.options || {});
    else if (probe.id === "webusb.device") value = globalThis.navigator?.usb?.requestDevice?.(payload.options || { filters: [] });
    else if (probe.id === "webserial.port") value = globalThis.navigator?.serial?.requestPort?.(payload.options || {});
    else if (probe.id === "webhid.device") value = globalThis.navigator?.hid?.requestDevice?.(payload.options || { filters: [] });
    return {
      status: value && typeof value.then === "function" ? "promise-pending" : "invoked",
      operation,
      returnType: value && typeof value.then === "function" ? "promise" : typeof value,
      detail: "browser API invoked through broker",
    };
  } catch (error) {
    return {
      status: "error",
      operation,
      detail: error?.message || String(error),
    };
  }
}

function invokeNotificationBroker(operation, payload = {}) {
  if (operation === "permission" || operation === "request-permission") {
    return globalThis.Notification?.requestPermission?.();
  }
  if (typeof globalThis.Notification === "function") {
    return new globalThis.Notification(payload.title || "DindbOS", payload.options || {});
  }
  return null;
}

function browserTrustedPromptMessage(probe = {}, operation = "request") {
  const target = probe.device || probe.id || "browser device";
  return `Allow ${probe.broker || "browser"} to ${operation} ${target}?`;
}

function formatBrowserCapabilities(capabilities = []) {
  return [
    "id status broker device api",
    ...capabilities.map((capability) => [
      capability.id,
      capability.available ? "available" : "unavailable",
      capability.broker,
      capability.device,
      capability.api,
    ].join(" ")),
  ].join("\n");
}

function formatIsolationStatus(status = {}) {
  const shared = status.sharedMemory || {};
  const worker = status.workerMemory || {};
  const regions = status.memoryRegions || [];
  return [
    `profile=${status.current || "unknown"} crossOriginIsolated=${Boolean(status.crossOriginIsolated)}`,
    `sharedMemory status=${shared.status || "unknown"} available=${Boolean(shared.available)} sab=${Boolean(shared.sharedArrayBuffer)} atomics=${Boolean(shared.atomics)} decision=${shared.decision || "-"}`,
    `headers coop=${status.deployment?.requiredHeaders?.["Cross-Origin-Opener-Policy"] || "-"} coep=${status.deployment?.requiredHeaders?.["Cross-Origin-Embedder-Policy"] || "-"} corp=${status.deployment?.requiredHeaders?.["Cross-Origin-Resource-Policy"] || "-"}`,
    `workerMemory status=${worker.status || "unknown"} transfer=${worker.transfer || "-"} maxRegionBytes=${Number(worker.maxRegionBytes || 0)} regions=${regions.length}`,
    `degraded=${status.degradedModes?.join("; ") || "-"}`,
  ].join("\n");
}

function formatServiceWorkerBootStatus(status = {}) {
  return [
    `service=${status.service || "dindbos-service-worker-boot"} supported=${Boolean(status.supported)} registered=${Boolean(status.registered)} controlled=${Boolean(status.controlled)} decision=${status.decision || "-"}`,
    `script=${status.scriptURL || "-"} scope=${status.scope || "-"} handshake=${status.handshake?.status || "-"}`,
    `profiles=${(status.safeBootProfiles || []).map((profile) => `${profile.id}:${profile.status}`).join(",") || "-"}`,
    `activeProfile=${status.safeBootEnforcement?.activeProfile || "-"} disables=${status.safeBootEnforcement?.disables?.join(",") || "-"}`,
    `offlineQueue queued=${Number(status.offlineMaintenanceQueue?.queued || 0)}`,
    `recoveryShell=${status.manifest?.recoveryShell || "-"}`,
    `closedPageExecution=${Boolean(status.closedPageExecution)}`,
  ].join("\n");
}

function formatConformanceReport(report = {}) {
  return [
    `version=${report.version || 1} runtime=${report.runtime?.name || "DindbOS.js"} mode=${report.runtime?.mode || "browser-native"}`,
    `summary total=${Number(report.summary?.total || 0)} supported=${Number(report.summary?.supported || 0)} partial=${Number(report.summary?.partial || 0)} degraded=${Number(report.summary?.degraded || 0)} companionRequired=${Number(report.summary?.["companion-required"] || 0)} planned=${Number(report.summary?.planned || 0)} unsupported=${Number(report.summary?.unsupported || 0)}`,
    `evidence total=${Number(report.evidenceSummary?.total || 0)} profiles=${Number(report.evidenceSummary?.profileCount || 0)} pass=${Number(report.evidenceSummary?.pass || 0)} fail=${Number(report.evidenceSummary?.fail || 0)} degraded=${Number(report.evidenceSummary?.degraded || 0)}`,
    ...(report.categories || []).map((category) => `${category.id} level=${category.level} evidence=${category.evidence?.join("|") || "-"} claim=${category.claim}`),
  ].join("\n");
}

function formatConformanceEvidence(payload = {}) {
  return [
    `service=${payload.service || "dindbos-conformance-evidence"} count=${payload.count || 0} updatedAt=${payload.updatedAt || "-"}`,
    ...(payload.records || []).map((record) => `${record.profile} status=${record.status} runner=${record.runner} categories=${record.categories?.join(",") || "-"} at=${record.recordedAt} artifacts=${record.artifacts?.join(",") || "-"}`),
  ].join("\n");
}

function formatSecureBootReport(report = {}) {
  const summary = report.summary || {};
  return [
    `service=${report.service || "dindbos-secure-boot"} ok=${Boolean(report.ok)} profile=${report.profile || "-"} algorithm=${report.algorithm || "-"}`,
    `measurements=${summary.measurementCount || 0} missing=${summary.missingCount || 0} packages=${summary.packageCount || 0} apps=${summary.appCount || 0} publishers=${summary.publisherCount || 0} policyProofFailures=${summary.policyProofFailures || 0}`,
    ...(report.measurements || []).map((entry) => `${entry.id} ${entry.status} ${entry.digest || "-"} bytes=${entry.bytes || 0}`),
  ].join("\n");
}

function formatDeviceTree(devices = []) {
  return [
    "path status driver capabilities",
    ...devices.map((device) => [
      device.path,
      device.status,
      device.driver,
      device.capabilities.join(",") || "-",
    ].join(" ")),
  ].join("\n");
}

function browserGrantRevocationKey({ pid = 0, appId = "", capability = "" } = {}) {
  return `${Number(pid || 0)}:${String(appId || "")}:${String(capability || "")}`;
}

function sanitizeIdentifier(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeSafeBootProfileId(value) {
  const profile = sanitizeIdentifier(value || "normal", "normal");
  const aliases = {
    safe: "safe-mode",
    packages: "package-disabled",
    services: "service-disabled",
    companions: "companion-disabled",
    repair: "storage-repair",
  };
  return aliases[profile] || profile;
}

function normalizeConformanceEvidenceRecord(record = {}) {
  const profile = sanitizeIdentifier(record.profile || record.browser || "chromium-tab", "chromium-tab");
  const status = ["pass", "fail", "degraded", "blocked"].includes(record.status) ? record.status : "blocked";
  const recordedAt = String(record.recordedAt || new Date().toISOString());
  return {
    id: sanitizeIdentifier(record.id || `${profile}-${recordedAt}`, `${profile}-${Date.now().toString(36)}`),
    profile,
    status,
    runner: String(record.runner || "manual"),
    recordedAt,
    categories: [...(record.categories || [])].map(String).filter(Boolean).sort(),
    artifacts: [...(record.artifacts || [])].map(String).filter(Boolean),
    notes: String(record.notes || ""),
  };
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
        ownerPid: Number(options.ownerPid || 0),
        ownerUid: Number(options.ownerUid ?? options.uid ?? 0),
        ownerGid: Number(options.ownerGid ?? options.gid ?? 0),
        ownerUser: String(options.ownerUser || options.user || ""),
        foregroundProcessGroupId: Number(options.foregroundProcessGroupId || 0),
        deviceMode: normalizePtyDeviceMode(options.deviceMode || options.permissions || "0600"),
        terminalMode: normalizePtyTerminalMode(options.terminalMode || options.mode || {}),
        columns: boundedInteger(options.columns, 80, 1, 1000),
        rows: boundedInteger(options.rows, 24, 1, 1000),
        input: String(options.input || ""),
        output: String(options.output || ""),
        events: [],
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(id, session);
      return { ...session };
    },
    attachSession(id, process = {}) {
      const session = sessions.get(String(id || ""));
      if (!session) return null;
      if (!session.ownerPid) {
        session.ownerPid = Number(process.pid || 0);
        session.ownerUid = Number(process.euid ?? process.uid ?? session.ownerUid ?? 0);
        session.ownerGid = Number(process.egid ?? process.gid ?? session.ownerGid ?? 0);
        session.ownerUser = String(process.user || session.ownerUser || "");
      }
      if (!session.foregroundProcessGroupId) session.foregroundProcessGroupId = Number(process.processGroupId || process.pid || 0);
      session.updatedAt = new Date().toISOString();
      return clonePtySession(session);
    },
    authorizeSession(id, process = {}, access = "open") {
      const session = sessions.get(String(id || ""));
      if (!session) throw codedError("ENODEV", `pty: ${id}: no such session`);
      const pid = Number(process.pid || 0);
      const processGroupId = Number(process.processGroupId || 0);
      const uid = Number(process.euid ?? process.uid ?? -1);
      const allowed = uid === 0
        || pid === Number(session.ownerPid || 0)
        || (processGroupId && processGroupId === Number(session.foregroundProcessGroupId || 0));
      if (!allowed) throw codedError("EACCES", `pty: ${id}: ${access}: permission denied`);
      return clonePtySession(session);
    },
    getSession(id) {
      const session = sessions.get(String(id || ""));
      return session ? clonePtySession(session) : null;
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
      session.events.push({ type: "resize", columns: session.columns, rows: session.rows, at: session.updatedAt });
      session.events = session.events.slice(-50);
      return clonePtySession(session);
    },
    setMode(id, mode = {}) {
      const session = sessions.get(String(id || ""));
      if (!session) return null;
      session.terminalMode = normalizePtyTerminalMode({ ...session.terminalMode, ...mode });
      session.updatedAt = new Date().toISOString();
      session.events.push({ type: "mode", mode: { ...session.terminalMode }, at: session.updatedAt });
      session.events = session.events.slice(-50);
      return clonePtySession(session);
    },
    signalSession(id, event = {}) {
      const session = sessions.get(String(id || ""));
      if (!session) return null;
      const record = {
        type: "signal",
        signal: String(event.signal || ""),
        pid: Number(event.pid || 0),
        appId: String(event.appId || ""),
        at: new Date().toISOString(),
      };
      session.events.push(record);
      session.events = session.events.slice(-50);
      session.updatedAt = record.at;
      return { ...record };
    },
    events(id) {
      return [...(sessions.get(String(id || ""))?.events || [])];
    },
    resizeEvent(id, size = {}) {
      const session = this.resizeSession(id, size);
      if (!session) return null;
      return session.events.at(-1) || null;
    },
    closeSession(id) {
      return sessions.delete(String(id || ""));
    },
    listSessions() {
      return [...sessions.values()].map(clonePtySession);
    },
  };
}

function clonePtySession(session) {
  return {
    ...session,
    terminalMode: { ...(session.terminalMode || {}) },
    events: [...(session.events || [])],
  };
}

function normalizePtyDeviceMode(mode = "0600") {
  const value = String(mode || "0600").replace(/^0o?/, "");
  return /^[0-7]{3,4}$/.test(value) ? value.padStart(4, "0") : "0600";
}

function normalizePtyTerminalMode(mode = {}) {
  return {
    canonical: mode.canonical !== false && mode.raw !== true,
    echo: mode.echo !== false && mode.raw !== true,
    signals: mode.signals !== false,
    raw: Boolean(mode.raw),
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
    objectId: record.objectId || "",
    handleId: record.handleId || "",
    createdAt: record.createdAt,
  };
}

function ipcObjectMetadata(record) {
  return {
    endpoint: record.endpoint,
    ownerPid: record.ownerPid || 0,
    ownerAppId: record.ownerAppId || "",
    ownerNamespace: record.ownerNamespace || "",
    ownerPackageId: record.ownerPackageId || "",
    createdAt: record.createdAt || "",
  };
}

function ipcHandleMetadata(record) {
  return {
    endpoint: record.endpoint,
    objectId: record.objectId || "",
    ownerAppId: record.ownerAppId || "",
    ownerNamespace: record.ownerNamespace || "",
    ownerPackageId: record.ownerPackageId || "",
  };
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stringifyDiagnosticsJson(value, spacing = 0) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, current) => {
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "function") return `[Function ${current.name || "anonymous"}]`;
    if (!current || typeof current !== "object") return current;

    const ctorName = current.constructor?.name || "Object";
    if (ctorName === "DindbOS") return "[DindbOS]";
    if (typeof Node !== "undefined" && current instanceof Node) return `[DOMNode ${current.nodeName || "Node"}]`;
    if (current instanceof Error) {
      return {
        name: current.name || "Error",
        message: current.message || "",
        stack: current.stack || "",
      };
    }
    if (seen.has(current)) return `[Circular ${ctorName}]`;
    seen.add(current);
    return current;
  }, spacing);
}

function formatBootPhaseDetail(detail) {
  if (detail === null || detail === undefined || detail === "") return "";
  if (typeof detail === "string") return detail;
  if (typeof detail === "number" || typeof detail === "boolean" || typeof detail === "bigint") return String(detail);
  if (detail instanceof Error) return detail.message || String(detail);
  if (Array.isArray(detail)) return detail.map((entry) => formatBootPhaseDetail(entry)).filter(Boolean).join(", ");
  if (typeof detail === "object") {
    if (detail.constructor?.name === "DindbOS") return "DindbOS runtime ready";
    if (detail.detail) return formatBootPhaseDetail(detail.detail);
    if (detail.message) return formatBootPhaseDetail(detail.message);
    if (detail.summary) return formatBootPhaseDetail(detail.summary);
    if (detail.reason) return formatBootPhaseDetail(detail.reason);
    return stringifyDiagnosticsJson(detail);
  }
  return String(detail);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function stableDigest(value) {
  const text = typeof value === "string" ? value : stableStringify(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
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

export { AppRegistry, AppSandbox, DescriptorManager, KernelObjectRegistry, RuntimeCacheStore, DesktopShell, EventBus, LocalFolderMountManager, NodeCompat, NpmInstaller, PackageManager, PermissionPolicy, PersistentStorage, ProcessManager, SyscallDispatcher, VirtualFileSystem, WasmRunner, WindowManager };
