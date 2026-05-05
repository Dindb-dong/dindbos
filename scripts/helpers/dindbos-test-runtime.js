import { AppRegistry } from "../../src/dindbos/app-registry.js";
import { AppSandbox } from "../../src/dindbos/app-sandbox.js";
import { RuntimeCacheStore } from "../../src/dindbos/cache-store.js";
import { DescriptorManager } from "../../src/dindbos/descriptors.js";
import { EventBus } from "../../src/dindbos/event-bus.js";
import { PackageManager } from "../../src/dindbos/package-manager.js";
import { PermissionPolicy } from "../../src/dindbos/permission-policy.js";
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
    cache: new RuntimeCacheStore({ cacheApi: null }),
    apps: null,
    packages: null,
    windows: null,
    processes: null,
    services: null,
    descriptors: null,
    syscalls: null,
    wasm: null,
    session,
    createSandbox: (process) => new AppSandbox(os, process),
    registerApp: (app) => os.apps.register(app),
    unregisterApp: (appId) => os.apps.unregister(appId),
    launch: (appId, context = {}) => os.apps.launch(appId, context),
  };

  os.windows = createTestWindowManager();
  os.descriptors = new DescriptorManager(os);
  os.processes = new ProcessManager(os);
  os.services = new ServiceManager(os);
  os.syscalls = new SyscallDispatcher(os);
  os.syscall = (name, args = {}, context = {}) => {
    const principal = context.principal || os.permissions.principal({ user: os.session.user, groups: os.session.groups });
    return os.syscalls.call(name, args, { ...context, principal });
  };
  os.wasm = new WasmRunner(os);
  os.apps = new AppRegistry(os);
  os.packages = new PackageManager(os);

  return os;
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
