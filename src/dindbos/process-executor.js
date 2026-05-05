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

class WorkerWasmExit extends Error {
  constructor(code = 0) {
    super("wasm exited");
    this.code = Number(code || 0);
  }
}

const handleWasmTask = async (message) => {
  const output = { stdout: "", stderr: "" };
  let instance = null;
  const readMemory = (ptr, length) => {
    const memory = instance?.exports?.memory;
    if (!memory) throw new Error("wasm: module must export memory");
    return new Uint8Array(memory.buffer, Number(ptr || 0), Number(length || 0));
  };
  const memoryView = () => {
    const memory = instance?.exports?.memory;
    if (!memory) throw new Error("wasm: module must export memory");
    return new DataView(memory.buffer);
  };
  const readString = (ptr, length) => new TextDecoder().decode(readMemory(ptr, length));
  const writeU32 = (ptr, value) => memoryView().setUint32(Number(ptr || 0), Number(value || 0), true);
  const writeMemory = (ptr, bytes) => readMemory(ptr, bytes.length).set(bytes);
  const assertMemoryLimit = () => {
    const limit = Number(message.maxMemoryPages);
    if (!Number.isFinite(limit) || limit < 0) return;
    const memory = instance?.exports?.memory;
    if (!memory?.buffer) return;
    const pages = Math.ceil(memory.buffer.byteLength / 65536);
    if (pages > limit) throw new Error("wasm: memory pages " + pages + " exceed limit " + limit);
  };
  const argv = message.argv || [];
  const env = message.env || {};
  const envEntries = Object.entries(env).map(([key, value]) => key + "=" + value);
  const cStringBytes = (values) => values.reduce((total, value) => total + new TextEncoder().encode(String(value) + "\\0").length, 0);
  const writeCStringArray = (pointersPtr, bufferPtr, values) => {
    let cursor = Number(bufferPtr || 0);
    values.forEach((value, index) => {
      const bytes = new TextEncoder().encode(String(value) + "\\0");
      writeU32(Number(pointersPtr || 0) + index * 4, cursor);
      writeMemory(cursor, bytes);
      cursor += bytes.length;
    });
  };
  const appendStdout = (data) => {
    output.stdout += data;
    send({ type: "stdout", data });
  };
  const appendStderr = (data) => {
    output.stderr += data;
    send({ type: "stderr", data });
  };
  const imports = {
    dindbos: {
      write: (ptr, length) => appendStdout(readString(ptr, length)),
      writeErr: (ptr, length) => appendStderr(readString(ptr, length)),
      argc: () => argv.length,
      writeArg: (index) => appendStdout(String(argv[Number(index)] ?? "")),
      writeEnv: (ptr, length) => appendStdout(String(env[readString(ptr, length)] ?? "")),
      syscall: () => 38,
      exit: (code) => {
        throw new WorkerWasmExit(code);
      },
    },
    wasi_snapshot_preview1: {
      args_sizes_get: (argcPtr, argvBufSizePtr) => {
        writeU32(argcPtr, argv.length);
        writeU32(argvBufSizePtr, cStringBytes(argv));
        return 0;
      },
      args_get: (argvPtr, argvBufPtr) => {
        writeCStringArray(argvPtr, argvBufPtr, argv);
        return 0;
      },
      environ_sizes_get: (environCountPtr, environBufSizePtr) => {
        writeU32(environCountPtr, envEntries.length);
        writeU32(environBufSizePtr, cStringBytes(envEntries));
        return 0;
      },
      environ_get: (environPtr, environBufPtr) => {
        writeCStringArray(environPtr, environBufPtr, envEntries);
        return 0;
      },
      fd_write: (fd, iovsPtr, iovsLength, nwrittenPtr) => {
        const view = memoryView();
        let written = 0;
        for (let index = 0; index < Number(iovsLength || 0); index += 1) {
          const base = Number(iovsPtr || 0) + index * 8;
          const ptr = view.getUint32(base, true);
          const length = view.getUint32(base + 4, true);
          const text = readString(ptr, length);
          if (Number(fd) === 2) appendStderr(text);
          else appendStdout(text);
          written += length;
        }
        writeU32(nwrittenPtr, written);
        return 0;
      },
      proc_exit: (code) => {
        throw new WorkerWasmExit(code);
      },
    },
  };
  let status = 0;
  try {
    const compiled = await WebAssembly.instantiate(new Uint8Array(message.bytes || []), imports);
    instance = compiled.instance || compiled;
    assertMemoryLimit();
    const start = instance.exports?._start || instance.exports?.main;
    if (typeof start !== "function") throw new Error("wasm: module must export _start or main");
    const returned = start();
    if (Number.isFinite(returned)) status = Number(returned);
  } catch (error) {
    if (error instanceof WorkerWasmExit) status = error.code;
    else {
      appendStderr(error.message || String(error));
      send({ type: "done", status: 1, crashed: true, ...output });
      return;
    }
  }
  send({ type: "done", status, ...output });
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
  if (message.kind === "wasm-task") {
    handleWasmTask(message).catch((error) => send({ type: "error", message: error.message || String(error) }));
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

  async runWasmTask(options = {}) {
    const backend = await this.resolveBackend(options.backend || "worker");
    if (backend !== "worker") throw executorError("ENOSYS", "worker wasm task requires worker backend");
    const cwd = options.cwd || this.os.session?.home || "/";
    const app = {
      id: options.appId || `wasm:${options.name || "worker"}`,
      name: options.name || "Worker WASM",
      manifest: {
        version: "0.1.0",
        entry: options.path || "wasm",
        capabilities: ["process.read", ...(options.capabilities || [])],
        fileSystem: {
          read: [...(options.fileSystem?.read || [cwd, options.path || ""])],
          write: [...(options.fileSystem?.write || [cwd])],
        },
      },
    };
    const process = this.os.processes.spawn(app, {
      argv: [...(options.argv || [])],
      cwd,
      executable: options.path || "",
      parentPid: options.parentPid || 0,
      runtime: "wasm",
      executionBackend: backend,
      executorState: "starting",
      executorKind: "wasm-output",
    });
    return this.runWorkerWasmTask(process, options);
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

  async runWorkerWasmTask(process, options = {}) {
    const workerRecord = await this.createWorker();
    const timeoutMs = Number(options.timeoutMs || 0);
    const output = { stdout: "", stderr: "" };
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
        this.os.processes.updateExecutorState(process.pid, {
          executorState: message.crashed ? "crashed" : "completed",
          executorDetail: `stdout=${output.stdout.length} stderr=${output.stderr.length}`,
        });
        if (message.crashed) {
          const error = executorError("EIO", output.stderr || "worker wasm crashed");
          this.os.processes.crash(process.pid, error);
          reject(error);
          return;
        }
        this.os.processes.markReady(process.pid);
        this.os.processes.kill(process.pid, Number(message.status || 0) === 0 ? "exited" : `exited-${Number(message.status || 0)}`);
        resolve({
          pid: process.pid,
          backend: "worker",
          status: Number(message.status || 0),
          stdout: output.stdout,
          stderr: output.stderr,
          crashed: false,
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
      workerRecord.onMessage((message = {}) => {
        if (message.type === "done") finish(message);
        else if (message.type === "error") fail(executorError("EIO", message.message || "worker error"));
        else if (message.type === "stdout") output.stdout += String(message.data || "");
        else if (message.type === "stderr") output.stderr += String(message.data || "");
      });
      workerRecord.onError(fail);
      this.os.processes.updateExecutorState(process.pid, {
        executorState: "running",
        executorDetail: `bytes=${options.bytes?.byteLength || options.bytes?.length || 0}`,
      });
      const bytes = options.bytes instanceof Uint8Array ? options.bytes : new Uint8Array(options.bytes || []);
      workerRecord.postMessage({
        kind: "wasm-task",
        bytes,
        argv: options.argv || [],
        env: options.env || {},
        maxMemoryPages: options.maxMemoryPages,
      }, [bytes.buffer]);
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
        postMessage: (message, transfer = []) => worker.postMessage(message, transfer),
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
      postMessage: (message, transfer = []) => worker.postMessage(message, transfer),
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
