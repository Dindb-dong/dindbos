const WORKER_SOURCE = `
let nodeParentPort = null;
try {
  nodeParentPort = require("node:worker_threads").parentPort;
} catch {}

const pendingSyscalls = new Map();
let nextRequestId = 1;

const send = (message, transfer = []) => {
  if (nodeParentPort) nodeParentPort.postMessage(message, transfer);
  else postMessage(message, transfer);
};

const requestSyscall = (name, args) => new Promise((resolve) => {
  const requestId = nextRequestId++;
  pendingSyscalls.set(requestId, resolve);
  send({ type: "syscall", requestId, name, args });
});

const handleSyscallResult = (message) => {
  const resolve = pendingSyscalls.get(message.requestId);
  if (!resolve) return;
  pendingSyscalls.delete(message.requestId);
  resolve(message.result);
};

const handleCpuTask = (message) => {
  const startedAt = Date.now();
  const durationMs = Math.max(0, Number(message.durationMs || 0));
  let iterations = 0;
  while (Date.now() - startedAt < durationMs) {
    iterations += 1;
  }
  send({ type: "done", iterations, durationMs, elapsedMs: Date.now() - startedAt });
};

const handleSyscallTask = async (message) => {
  const results = [];
  const output = { stdout: "", stderr: "", binaryBytes: 0 };
  for (const operation of message.operations || []) {
    if (operation.type === "stdout") {
      const data = String(operation.data ?? "");
      output.stdout += data;
      send({ type: "stdout", data });
      continue;
    }
    if (operation.type === "stderr") {
      const data = String(operation.data ?? "");
      output.stderr += data;
      send({ type: "stderr", data });
      continue;
    }
    if (operation.type !== "syscall") continue;
    const result = await requestSyscall(operation.name, operation.args || {});
    results.push({ name: operation.name, result });
    if (operation.expectErrorCode && result?.error?.code !== operation.expectErrorCode) {
      send({ type: "stderr", data: "unexpected syscall result" });
      send({ type: "done", status: 1, results });
      return;
    }
    if (operation.stdoutValue && result?.ok) {
      const data = String(result.value ?? "");
      output.stdout += data;
      send({ type: "stdout", data });
    }
    if (operation.stderrErrorCode && !result?.ok) {
      const data = String(result.error?.code || "EIO");
      output.stderr += data;
      send({ type: "stderr", data });
    }
    if (operation.binaryResult && result?.ok) {
      const buffer = new Uint8Array(result.value || []).buffer;
      output.binaryBytes += buffer.byteLength;
      send({ type: "binary", buffer }, [buffer]);
    }
  }
  send({ type: "done", status: 0, results, ...output });
};

const handle = (message) => {
  if (message.type === "syscallResult") {
    handleSyscallResult(message);
    return;
  }
  if (message.kind === "syscall-task") {
    handleSyscallTask(message).catch((error) => send({ type: "error", message: error.message || String(error) }));
    return;
  }
  handleCpuTask(message);
};

if (nodeParentPort) nodeParentPort.on("message", handle);
else onmessage = (event) => handle(event.data || {});
`;

export class ProcessExecutor {
  constructor(os) {
    this.os = os;
    this.running = new Map();
    this.os.bus?.on?.("process:exit", (process) => this.terminate(process.pid, "process-exit"));
    this.os.bus?.on?.("process:crash", (process) => this.terminate(process.pid, "process-crash"));
  }

  async runCpuTask(options = {}) {
    const backend = await this.resolveBackend(options.backend || "worker");
    const app = {
      id: options.appId || "worker:cpu-task",
      name: options.name || "CPU Worker Task",
      manifest: {
        version: "0.1.0",
        entry: "process-executor",
        capabilities: ["process.read"],
      },
    };
    const process = this.os.processes.spawn(app, {
      cwd: options.cwd || this.os.session?.home || "/",
      runtime: "process-executor",
      executionBackend: backend,
      executorState: "starting",
      executorKind: "cpu-task",
    });
    if (backend === "worker") return this.runWorkerCpuTask(process, options);
    return this.runMainThreadCpuTask(process, options);
  }

  async runSyscallTask(options = {}) {
    const backend = await this.resolveBackend(options.backend || "worker");
    const cwd = options.cwd || this.os.session?.home || "/";
    const manifest = {
      version: "0.1.0",
      entry: "process-executor",
      capabilities: ["process.read", ...(options.capabilities || [])],
      fileSystem: {
        read: [...(options.fileSystem?.read || [cwd])],
        write: [...(options.fileSystem?.write || [cwd])],
      },
    };
    const app = {
      id: options.appId || "worker:syscall-task",
      name: options.name || "Worker Syscall Task",
      manifest,
    };
    const process = this.os.processes.spawn(app, {
      cwd,
      runtime: "process-executor",
      executionBackend: backend,
      executorState: "starting",
      executorKind: "syscall-bridge",
    });
    if (backend !== "worker") return this.runMainThreadSyscallTask(process, options);
    return this.runWorkerSyscallTask(process, options);
  }

  terminate(pid, reason = "terminated") {
    const record = this.running.get(Number(pid));
    if (!record) return false;
    clearTimeout(record.timeoutId);
    record.terminated = true;
    try {
      record.worker?.terminate?.();
    } catch {}
    try {
      if (record.objectUrl && typeof URL !== "undefined") URL.revokeObjectURL(record.objectUrl);
    } catch {}
    this.running.delete(Number(pid));
    this.os.processes.updateExecutorState?.(pid, {
      executorState: "terminated",
      executorDetail: reason,
    });
    record.reject?.(executorError("ETERMINATED", `process executor terminated: ${reason}`));
    return true;
  }

  async runWorkerCpuTask(process, options = {}) {
    const workerRecord = await this.createWorker();
    const durationMs = Math.max(0, Number(options.durationMs || 0));
    const timeoutMs = Number(options.timeoutMs || 0);
    return new Promise((resolve, reject) => {
      const record = {
        ...workerRecord,
        reject,
        terminated: false,
        timeoutId: null,
      };
      this.running.set(process.pid, record);
      const cleanup = () => {
        clearTimeout(record.timeoutId);
        this.running.delete(process.pid);
        try {
          record.worker.terminate?.();
        } catch {}
        try {
          if (record.objectUrl && typeof URL !== "undefined") URL.revokeObjectURL(record.objectUrl);
        } catch {}
      };
      const finish = (message = {}) => {
        if (record.terminated) return;
        cleanup();
        this.os.processes.updateExecutorState(process.pid, {
          executorState: "completed",
          executorDetail: `iterations=${message.iterations || 0}`,
        });
        this.os.processes.markReady(process.pid);
        this.os.processes.kill(process.pid, "exited");
        resolve({
          pid: process.pid,
          backend: "worker",
          status: 0,
          iterations: Number(message.iterations || 0),
          elapsedMs: Number(message.elapsedMs || 0),
        });
      };
      const fail = (error) => {
        if (record.terminated) return;
        cleanup();
        this.os.processes.updateExecutorState(process.pid, {
          executorState: "crashed",
          executorDetail: error?.message || String(error),
        });
        this.os.processes.crash(process.pid, error);
        reject(error);
      };
      if (timeoutMs > 0) {
        record.timeoutId = setTimeout(() => {
          record.terminated = true;
          cleanup();
          const error = executorError("ETIMEOUT", `process executor timeout after ${timeoutMs}ms`);
          this.os.processes.updateExecutorState(process.pid, {
            executorState: "timeout",
            executorDetail: error.message,
          });
          this.os.processes.crash(process.pid, error);
          reject(error);
        }, timeoutMs);
      }
      workerRecord.onMessage(finish);
      workerRecord.onError(fail);
      this.os.processes.updateExecutorState(process.pid, {
        executorState: "running",
        executorDetail: `durationMs=${durationMs}`,
      });
      workerRecord.postMessage({ durationMs });
    });
  }

  async runMainThreadCpuTask(process, options = {}) {
    const durationMs = Math.max(0, Number(options.durationMs || 0));
    this.os.processes.updateExecutorState(process.pid, {
      executorState: "running",
      executorDetail: `durationMs=${durationMs}`,
    });
    const startedAt = Date.now();
    let iterations = 0;
    while (Date.now() - startedAt < durationMs) iterations += 1;
    this.os.processes.updateExecutorState(process.pid, {
      executorState: "completed",
      executorDetail: `iterations=${iterations}`,
    });
    this.os.processes.markReady(process.pid);
    this.os.processes.kill(process.pid, "exited");
    return {
      pid: process.pid,
      backend: "main-thread",
      status: 0,
      iterations,
      elapsedMs: Date.now() - startedAt,
    };
  }

  async runWorkerSyscallTask(process, options = {}) {
    const workerRecord = await this.createWorker();
    const timeoutMs = Number(options.timeoutMs || 0);
    const output = { stdout: "", stderr: "", binaryBytes: 0 };
    return new Promise((resolve, reject) => {
      const record = {
        ...workerRecord,
        reject,
        terminated: false,
        timeoutId: null,
      };
      this.running.set(process.pid, record);
      const cleanup = () => {
        clearTimeout(record.timeoutId);
        this.running.delete(process.pid);
        try {
          record.worker.terminate?.();
        } catch {}
        try {
          if (record.objectUrl && typeof URL !== "undefined") URL.revokeObjectURL(record.objectUrl);
        } catch {}
      };
      const finish = (message = {}) => {
        if (record.terminated) return;
        cleanup();
        if (message.stdout !== undefined) output.stdout = String(message.stdout || "");
        if (message.stderr !== undefined) output.stderr = String(message.stderr || "");
        if (message.binaryBytes !== undefined) output.binaryBytes = Number(message.binaryBytes || 0);
        this.os.processes.updateExecutorState(process.pid, {
          executorState: Number(message.status || 0) === 0 ? "completed" : "failed",
          executorDetail: `stdout=${output.stdout.length} stderr=${output.stderr.length} binary=${output.binaryBytes}`,
        });
        if (Number(message.status || 0) === 0) {
          this.os.processes.markReady(process.pid);
          this.os.processes.kill(process.pid, "exited");
          resolve({
            pid: process.pid,
            backend: "worker",
            status: 0,
            stdout: output.stdout,
            stderr: output.stderr,
            binaryBytes: output.binaryBytes,
            results: message.results || [],
          });
        } else {
          const error = executorError("EIO", "worker syscall task failed");
          this.os.processes.crash(process.pid, error);
          reject(error);
        }
      };
      const fail = (error) => {
        if (record.terminated) return;
        cleanup();
        this.os.processes.updateExecutorState(process.pid, {
          executorState: "crashed",
          executorDetail: error?.message || String(error),
        });
        this.os.processes.crash(process.pid, error);
        reject(error);
      };
      if (timeoutMs > 0) {
        record.timeoutId = setTimeout(() => {
          record.terminated = true;
          cleanup();
          const error = executorError("ETIMEOUT", `process executor timeout after ${timeoutMs}ms`);
          this.os.processes.updateExecutorState(process.pid, {
            executorState: "timeout",
            executorDetail: error.message,
          });
          this.os.processes.crash(process.pid, error);
          reject(error);
        }, timeoutMs);
      }
      workerRecord.onMessage((message = {}) => {
        if (message.type === "done") finish(message);
        else if (message.type === "error") fail(executorError("EIO", message.message || "worker error"));
        else if (message.type === "stdout") output.stdout += String(message.data || "");
        else if (message.type === "stderr") output.stderr += String(message.data || "");
        else if (message.type === "binary") output.binaryBytes += Number(message.buffer?.byteLength || 0);
        else if (message.type === "syscall") {
          const result = this.os.syscall(message.name, message.args || {}, this.executorContext(process, options));
          workerRecord.postMessage({ type: "syscallResult", requestId: message.requestId, result });
        }
      });
      workerRecord.onError(fail);
      this.os.processes.updateExecutorState(process.pid, {
        executorState: "running",
        executorDetail: `operations=${(options.operations || []).length}`,
      });
      workerRecord.postMessage({ kind: "syscall-task", operations: options.operations || [] });
    });
  }

  async runMainThreadSyscallTask(process, options = {}) {
    const output = { stdout: "", stderr: "", binaryBytes: 0 };
    const results = [];
    const context = this.executorContext(process, options);
    this.os.processes.updateExecutorState(process.pid, {
      executorState: "running",
      executorDetail: `operations=${(options.operations || []).length}`,
    });
    for (const operation of options.operations || []) {
      if (operation.type === "stdout") output.stdout += String(operation.data ?? "");
      else if (operation.type === "stderr") output.stderr += String(operation.data ?? "");
      else if (operation.type === "syscall") {
        const result = this.os.syscall(operation.name, operation.args || {}, context);
        results.push({ name: operation.name, result });
        if (operation.expectErrorCode && result?.error?.code !== operation.expectErrorCode) {
          output.stderr += "unexpected syscall result";
          break;
        }
        if (operation.stdoutValue && result?.ok) output.stdout += String(result.value ?? "");
        if (operation.stderrErrorCode && !result?.ok) output.stderr += String(result.error?.code || "EIO");
        if (operation.binaryResult && result?.ok) output.binaryBytes += new Uint8Array(result.value || []).byteLength;
      }
    }
    this.os.processes.updateExecutorState(process.pid, {
      executorState: "completed",
      executorDetail: `stdout=${output.stdout.length} stderr=${output.stderr.length} binary=${output.binaryBytes}`,
    });
    this.os.processes.markReady(process.pid);
    this.os.processes.kill(process.pid, "exited");
    return {
      pid: process.pid,
      backend: "main-thread",
      status: 0,
      stdout: output.stdout,
      stderr: output.stderr,
      binaryBytes: output.binaryBytes,
      results,
    };
  }

  executorContext(process, options = {}) {
    return {
      process,
      env: {
        USER: this.os.session?.user || "guest",
        HOME: this.os.session?.home || "/home/guest",
        SHELL: "/bin/dindbsh",
        PATH: "/bin:/usr/bin",
        PWD: process.cwd || options.cwd || this.os.session?.home || "/",
      },
      principal: this.os.permissions.principal({ user: process.user, groups: this.os.session?.groups || ["users"] }),
      assertFileSystem: (path, access) => this.assertFileSystem(process, path, access),
      assertCapability: (capability) => this.assertCapability(process, capability),
    };
  }

  assertFileSystem(process, path, access) {
    const fileSystem = process.manifest?.fileSystem || {};
    const scopes = access === "write" ? fileSystem.write || [] : fileSystem.read || [];
    if (scopes.some((scope) => path === scope || path.startsWith(`${scope}/`))) return;
    throw new Error(`worker: ${access}: ${path}: sandbox denied`);
  }

  assertCapability(process, capability) {
    if ((process.manifest?.capabilities || []).includes(capability)) return;
    throw new Error(`worker: capability denied: ${capability}`);
  }

  async resolveBackend(preferred) {
    if (preferred === "main-thread") return "main-thread";
    if (await this.workerAvailable()) return "worker";
    return "main-thread";
  }

  async workerAvailable() {
    if (typeof Worker === "function") return true;
    return Boolean(await nodeWorkerConstructor());
  }

  async createWorker() {
    const NodeWorker = await nodeWorkerConstructor();
    if (NodeWorker) {
      const worker = new NodeWorker(WORKER_SOURCE, { eval: true });
      return {
        worker,
        postMessage: (message) => worker.postMessage(message),
        onMessage: (listener) => worker.on("message", listener),
        onError: (listener) => worker.once("error", listener),
      };
    }
    if (typeof Worker !== "function") throw executorError("ENOSYS", "process executor worker backend is unavailable");
    const blob = new Blob([WORKER_SOURCE], { type: "text/javascript" });
    const objectUrl = URL.createObjectURL(blob);
    const worker = new Worker(objectUrl);
    return {
      worker,
      objectUrl,
      postMessage: (message) => worker.postMessage(message),
      onMessage: (listener) => {
        worker.onmessage = (event) => listener(event.data || {});
      },
      onError: (listener) => {
        worker.onerror = (event) => listener(new Error(event.message || "worker error"));
      },
    };
  }
}

async function nodeWorkerConstructor() {
  if (!globalThis.process?.versions?.node) return null;
  try {
    const workerThreads = await import("node:worker_threads");
    return workerThreads.Worker || null;
  } catch {
    return null;
  }
}

function executorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
