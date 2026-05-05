const WORKER_SOURCE = `
let nodeParentPort = null;
try {
  nodeParentPort = require("node:worker_threads").parentPort;
} catch {}

const send = (message) => {
  if (nodeParentPort) nodeParentPort.postMessage(message);
  else postMessage(message);
};

const handle = (message) => {
  const startedAt = Date.now();
  const durationMs = Math.max(0, Number(message.durationMs || 0));
  let iterations = 0;
  while (Date.now() - startedAt < durationMs) {
    iterations += 1;
  }
  send({ type: "done", iterations, durationMs, elapsedMs: Date.now() - startedAt });
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
        onMessage: (listener) => worker.once("message", listener),
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
