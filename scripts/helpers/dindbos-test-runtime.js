import { AppRegistry } from "../../src/dindbos/app-registry.js";
import { AppSandbox } from "../../src/dindbos/app-sandbox.js";
import { RuntimeCacheStore } from "../../src/dindbos/cache-store.js";
import { DescriptorManager } from "../../src/dindbos/descriptors.js";
import { EventBus } from "../../src/dindbos/event-bus.js";
import { KernelObjectRegistry } from "../../src/dindbos/kernel-objects.js";
import { KeychainManager } from "../../src/dindbos/keychain.js";
import { NetworkBroker } from "../../src/dindbos/network-broker.js";
import { PackageManager } from "../../src/dindbos/package-manager.js";
import { PermissionPolicy } from "../../src/dindbos/permission-policy.js";
import { ProcessExecutor } from "../../src/dindbos/process-executor.js";
import { ProcessManager } from "../../src/dindbos/process-manager.js";
import { ServiceManager } from "../../src/dindbos/service-manager.js";
import { SyscallDispatcher } from "../../src/dindbos/syscalls.js";
import { VirtualFileSystem } from "../../src/dindbos/vfs.js";
import { WasmRunner } from "../../src/dindbos/wasm-runner.js";

export function createDindbOSTestRuntime(root = null, options = {}) {
  const home = options.home || "/home/guest";
  const session = options.session || { user: "guest", groups: ["users"], home };
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(root, { home, policy: permissions });
  const system = permissions.systemPrincipal();
  ensureDirectory(fs, "/home", system);
  ensureDirectory(fs, home, system, { owner: session.user, group: "users" });

  const os = {
    fs,
    permissions,
    bus: new EventBus(),
    ipcEndpoints: new Map(),
    cache: new RuntimeCacheStore({ cacheApi: null }),
    apps: null,
    packages: null,
    windows: null,
    processes: null,
    services: null,
    descriptors: null,
    executor: null,
    syscalls: null,
    wasm: null,
    keychain: null,
    network: null,
    objects: null,
    operationLocks: new Map(),
    session,
    createSandbox: (process) => new AppSandbox(os, process),
    registerApp: (app) => os.apps.register(app),
    unregisterApp: (appId) => os.apps.unregister(appId),
    launch: (appId, context = {}) => os.apps.launch(appId, context),
  };
  os.registerIpcEndpoint = (process, endpoint, handler) => registerIpcEndpoint(os, process, endpoint, handler);
  os.sendIpcMessage = (process, endpoint, payload = {}) => sendIpcMessage(os, process, endpoint, payload);
  os.listIpcEndpoints = (process = null) => listIpcEndpoints(os, process);
  os.unregisterIpcEndpointsForPid = (pid) => unregisterIpcEndpointsForPid(os, pid);
  os.unregisterIpcEndpointsForNamespace = (namespace, reason) => unregisterIpcEndpointsForNamespace(os, namespace, reason);
  os.withRuntimeOperationLock = (name, details, callback) => withRuntimeOperationLock(os, name, details, callback);
  os.acquireRuntimeOperationLock = (name, details) => acquireRuntimeOperationLock(os, name, details);
  os.releaseRuntimeOperationLock = (name, record) => releaseRuntimeOperationLock(os, name, record);
  os.readRuntimeOperationLock = (name) => os.operationLocks.get(operationLockKey(name)) || null;

  os.windows = createTestWindowManager();
  os.objects = new KernelObjectRegistry(os);
  os.descriptors = new DescriptorManager(os);
  os.processes = new ProcessManager(os);
  os.executor = new ProcessExecutor(os);
  os.services = new ServiceManager(os);
  os.syscalls = new SyscallDispatcher(os);
  os.syscall = (name, args = {}, context = {}) => {
    const principal = context.principal || os.permissions.principal({ user: os.session.user, groups: os.session.groups });
    return os.syscalls.call(name, args, { ...context, principal });
  };
  os.wasm = new WasmRunner(os);
  os.apps = new AppRegistry(os);
  os.packages = new PackageManager(os);
  os.keychain = new KeychainManager(os);
  os.network = new NetworkBroker(os, {
    fetch: options.networkFetch,
    webSocket: options.networkWebSocket,
    rtcPeerConnection: options.networkPeerConnection,
    rawSocketCompanion: options.networkRawSocketCompanion,
  });

  return os;
}

function registerIpcEndpoint(os, process, endpoint, handler) {
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
  registerIpcKernelObject(os, record, process);
  os.ipcEndpoints.set(id, record);
  return publicIpcEndpoint(record);
}

function sendIpcMessage(os, process, endpoint, payload = {}) {
  const id = normalizeIpcEndpoint(endpoint);
  const record = os.ipcEndpoints.get(id);
  if (!record) throw new Error(`ipc: ${id}: no such endpoint`);
  assertIpcSendAllowed(process, record);
  assertIpcEndpointHandle(os, record);
  return cloneJson(record.handler({
    endpoint: id,
    fromPid: process?.pid || 0,
    fromAppId: process?.appId || "",
    fromNamespace: process?.manifest?.namespace?.processGroup || "",
    toPid: record.ownerPid,
    toAppId: record.ownerAppId,
    toNamespace: record.ownerNamespace,
    payload: cloneJson(payload),
    sentAt: new Date().toISOString(),
  }));
}

function listIpcEndpoints(os, process = null) {
  return [...os.ipcEndpoints.values()]
    .filter((record) => !process || canSeeIpcEndpoint(process, record))
    .map(publicIpcEndpoint);
}

function unregisterIpcEndpointsForPid(os, pid) {
  [...os.ipcEndpoints.entries()].forEach(([endpoint, record]) => {
    if (Number(record.ownerPid || 0) === Number(pid || 0)) {
      os.ipcEndpoints.delete(endpoint);
      revokeIpcKernelObject(os, record, "process-exit");
    }
  });
}

function unregisterIpcEndpointsForNamespace(os, namespace = {}) {
  const processGroup = String(namespace.processGroup || "").trim();
  const packageId = String(namespace.packageId || "").trim();
  const removed = [];
  [...os.ipcEndpoints.entries()].forEach(([endpoint, record]) => {
    const sameProcessGroup = processGroup && record.ownerNamespace === processGroup;
    const samePackage = packageId && record.ownerPackageId === packageId;
    if (!sameProcessGroup && !samePackage) return;
    os.ipcEndpoints.delete(endpoint);
    revokeIpcKernelObject(os, record, "namespace-cleanup");
    removed.push(publicIpcEndpoint(record));
  });
  return removed;
}

function registerIpcKernelObject(os, record, process = null) {
  const object = os.objects?.register?.("ipc", {
    ref: `ipc:${record.endpoint}`,
    name: record.endpoint,
    ownerPid: record.ownerPid,
    namespace: process?.manifest?.namespace || null,
    user: process?.user || os.session.user || "",
    rights: ["inspect", "receive", "send", "close"],
    metadata: ipcObjectMetadata(record),
  }) || null;
  record.objectId = object?.id || "";
  const handle = record.objectId ? os.objects?.createHandle?.(record.objectId, {
    ownerPid: record.ownerPid,
    user: process?.user || os.session.user || "",
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

function assertIpcEndpointHandle(os, record) {
  if (!record?.handleId) return null;
  return os.objects?.assertHandle?.(record.handleId, {
    ownerPid: record.ownerPid,
    objectType: "ipc",
    rights: ["receive"],
  }) || null;
}

function revokeIpcKernelObject(os, record, reason = "ipc-unregister") {
  if (!record?.objectId) return null;
  return os.objects?.revoke?.(record.objectId, reason) || null;
}

function withRuntimeOperationLock(os, name, details = {}, callback = () => null) {
  const lock = acquireRuntimeOperationLock(os, name, details);
  let result;
  try {
    result = callback(lock);
  } catch (error) {
    releaseRuntimeOperationLock(os, name, lock);
    throw error;
  }
  if (result && typeof result.then === "function") {
    return result.finally(() => releaseRuntimeOperationLock(os, name, lock));
  }
  releaseRuntimeOperationLock(os, name, lock);
  return result;
}

function acquireRuntimeOperationLock(os, name, details = {}) {
  const key = operationLockKey(name);
  const existing = os.operationLocks.get(key);
  if (existing) throw new Error(`${name}: operation locked by ${existing.owner}`);
  const record = {
    name,
    owner: "test-runtime",
    operation: String(details.operation || ""),
    packageId: String(details.packageId || ""),
    acquiredAt: new Date().toISOString(),
  };
  os.operationLocks.set(key, record);
  return record;
}

function releaseRuntimeOperationLock(os, name, record = null) {
  const key = operationLockKey(name);
  const existing = os.operationLocks.get(key);
  if (existing && record && existing.owner !== record.owner) return false;
  os.operationLocks.delete(key);
  return true;
}

function operationLockKey(name) {
  return `dindbos:operation-lock:${String(name || "runtime")}`;
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

export async function launchRuntimeApp(os, appId, options = {}) {
  const window = os.apps.launch(appId, options.context || {});
  await window.rendered;
  if (options.until) await waitForRuntime(options.until, options.label || `app ${appId} did not reach expected state`, options.timeoutMs);
  return window;
}

export async function waitForRuntime(check, label, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(label);
}

function createTestWindowManager() {
  const records = new Map();
  return {
    records,
    has: (windowId) => records.has(windowId),
    activate: (windowId) => records.get(windowId),
    close: (windowId) => {
      const record = records.get(windowId) || null;
      records.delete(windowId);
      return record;
    },
    open: (options) => {
      const content = { innerHTML: "" };
      const windowApi = {
        setTitle: (title) => {
          options.title = title;
        },
      };
      const windowRecord = { ...options, content };
      records.set(options.id, windowRecord);
      windowRecord.rendered = Promise.resolve(options.render(content, windowApi));
      return windowRecord;
    },
  };
}

function ensureDirectory(fs, path, principal, metadata = {}) {
  if (!fs.exists(path)) {
    fs.createDirectory(path, "/", {
      owner: metadata.owner || "root",
      group: metadata.group || "root",
      permissions: metadata.permissions || "drwxr-xr-x",
    }, principal);
  }
}
