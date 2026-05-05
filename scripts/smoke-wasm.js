#!/usr/bin/env node
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
import { DindbOS } from "../src/dindbos/index.js";
import { ShellSession } from "../src/dindbos/shell.js";

const storage = memoryStorage();
const os = new DindbOS({ root: {}, storage });
const system = os.permissions.systemPrincipal();
os.ensureDirectoryPath("/home/guest/bin", { leafOwner: "guest", leafGroup: "users", principal: system });
os.ensureDirectoryPath("/home/guest/shared", { leafOwner: "guest", leafGroup: "users", principal: system });

os.fs.writeOrCreateFileBytes("/home/guest/bin/hello.wasm", helloWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/syscall.wasm", syscallWriteWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/syscall-async-sync.wasm", syscallAsyncStorageSyncWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/syscall-async-denied.wasm", syscallAsyncStorageSyncWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/exit7.wasm", exitWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/denied.wasm", deniedWriteWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/scoped-write.wasm", scopedWriteWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/trap.wasm", trapWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/deadline.wasm", deadlineWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/slow-deadline.wasm", deadlineWasm(300000), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/grow-memory.wasm", growMemoryWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-hello.wasm", wasiHelloWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-cat.wasm", wasiCatWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-open-read.wasm", wasiOpenReadWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-open-write.wasm", wasiOpenWriteWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-sync-write.wasm", wasiSyncWriteWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-rights.wasm", wasiRightsWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-filestat.wasm", wasiFilestatWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-readdir.wasm", wasiReaddirWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-mkdir.wasm", wasiMkdirWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-remove.wasm", wasiRemoveWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-rename.wasm", wasiRenameWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-symlink.wasm", wasiSymlinkWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFileBytes("/home/guest/bin/wasi-hardlink.wasm", wasiHardLinkWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);
os.fs.writeOrCreateFile("/home/guest/bin/wasi-file.txt", "opened read\n", "/", {
  owner: "guest",
  group: "users",
  permissions: "-rw-r--r--",
}, system);
os.fs.writeOrCreateFile("/home/guest/bin/wasi-delete.txt", "delete me\n", "/", {
  owner: "guest",
  group: "users",
  permissions: "-rw-r--r--",
}, system);
os.fs.createDirectory("/home/guest/bin/wasi-remove-dir", "/", {
  owner: "guest",
  group: "users",
}, system);
os.fs.writeOrCreateFile("/home/guest/bin/wasi-rename-from.txt", "rename me\n", "/", {
  owner: "guest",
  group: "users",
  permissions: "-rw-r--r--",
}, system);
os.fs.createDirectory("/home/guest/bin/wasi-rename-dir", "/", {
  owner: "guest",
  group: "users",
}, system);
os.fs.writeOrCreateFile("/home/guest/bin/wasi-symlink-target.txt", "through symlink\n", "/", {
  owner: "guest",
  group: "users",
  permissions: "-rw-r--r--",
}, system);
os.fs.writeOrCreateFile("/home/guest/bin/wasi-hardlink-source.txt", "linked data\n", "/", {
  owner: "guest",
  group: "users",
  permissions: "-rw-r--r--",
}, system);

const shell = new ShellSession(os);
let result;
os.ensureDirectoryPath("/mnt", { leafOwner: "root", leafGroup: "root", principal: system });
const mounted = os.syscall("mount.mount", { path: "/mnt/cross-runtime", driver: "memfs" });
assert(mounted.ok && mounted.value.root === "/mnt/cross-runtime", `cross-runtime memfs mount failed: ${JSON.stringify(mounted)}`);
os.fs.writeOrCreateFile("/mnt/cross-runtime/wasi-file.txt", "opened read\n", "/", { owner: "guest", group: "users", permissions: "-rw-r--r--" }, system);
result = await shell.executeAsync("cat /mnt/cross-runtime/wasi-file.txt");
assert(result.status === 0 && result.output === "opened read\n", `shell mounted path read mismatch: ${result.status} ${JSON.stringify(result.output)}`);
const mountedSandbox = new AppSandbox(os, {
  pid: 901,
  appId: "mounted-reader",
  user: "guest",
  cwd: "/home/guest",
  manifest: {
    capabilities: [],
    fileSystem: {
      read: ["/mnt/cross-runtime"],
      write: [],
    },
  },
});
assert(mountedSandbox.fs.readFile("/mnt/cross-runtime/wasi-file.txt") === "opened read\n", "app sandbox mounted path read mismatch");
const mountedNode = os.node.evaluate("const fs = require('fs'); console.log(fs.readFileSync('/mnt/cross-runtime/wasi-file.txt', 'utf8'));", "/home/guest");
assert(mountedNode.status === 0 && mountedNode.output.trim() === "opened read", `NodeCompat mounted path read mismatch: ${mountedNode.status} ${JSON.stringify(mountedNode.output)}`);
const mountedWasi = await os.wasm.runFile("/home/guest/bin/wasi-open-read.wasm", "/mnt/cross-runtime", {
  argv: ["wasi-open-read.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(mountedWasi.status === 0 && mountedWasi.stdout === "opened read\n", `WASI mounted path read mismatch: ${mountedWasi.status} ${JSON.stringify(mountedWasi.stdout)} ${mountedWasi.stderr}`);
result = await shell.executeAsync("export PATH=$PATH:/home/guest/bin && hello.wasm max");
assert(result.status === 0, `shell wasm status mismatch: ${result.status} ${result.output}`);
assert(result.output === "hello max\nuser=guest\n", `shell wasm output mismatch: ${JSON.stringify(result.output)}`);
assert(os.processes.history.some((process) => process.appId === "wasm:hello.wasm"), "wasm shell run was not tracked as a process");

const syscallRun = await os.wasm.runFile("/home/guest/bin/syscall.wasm", "/home/guest/bin", {
  principal: os.permissions.principal(os.session),
});
assert(syscallRun.status === 0, `wasm syscall run status mismatch: ${syscallRun.status} ${syscallRun.stderr}`);
assert(os.fs.readFile("/home/guest/bin/wasm-syscall.txt") === "from wasm syscall", "wasm syscall did not write through DindbOS syscall ABI");
assert(os.fs.readFile("/var/log/dindbos/syscall.log").includes("fs.writeText OK"), "wasm syscall did not write global syscall trace");

const beforeAsyncStorageSyncFlushes = storage.flushes;
const asyncStorageSyncRun = await os.wasm.runFile("/home/guest/bin/syscall-async-sync.wasm", "/home/guest/bin", {
  capabilities: ["storage.read"],
  principal: os.permissions.principal(os.session),
});
assert(asyncStorageSyncRun.status === 0, `wasm async syscall sync status mismatch: ${asyncStorageSyncRun.status} ${asyncStorageSyncRun.stderr}`);
assert(storage.flushes > beforeAsyncStorageSyncFlushes, "wasm async syscall did not wait for storage sync flush");
assert(os.fs.readFile("/var/log/dindbos/syscall.log").includes("storage.sync OK"), "wasm async syscall did not write storage.sync trace");

const asyncStorageDeniedRun = await os.wasm.runFile("/home/guest/bin/syscall-async-denied.wasm", "/home/guest/bin", {
  principal: os.permissions.principal(os.session),
});
assert(asyncStorageDeniedRun.status === 13, `wasm async syscall denial status mismatch: ${asyncStorageDeniedRun.status} ${asyncStorageDeniedRun.stderr}`);
assert(asyncStorageDeniedRun.crashed === false, "wasm async syscall denial should not crash the process");
assert(os.fs.readFile("/var/log/dindbos/syscall.log").includes("storage.sync EACCES"), "wasm async syscall did not write denied storage.sync trace");

const exitRun = await os.wasm.runFile("/home/guest/bin/exit7.wasm", "/home/guest/bin", {
  principal: os.permissions.principal(os.session),
});
assert(exitRun.status === 7, `wasm exit status mismatch: ${exitRun.status}`);

const deniedRun = await os.wasm.runFile("/home/guest/bin/denied.wasm", "/home/guest/bin", {
  principal: os.permissions.principal(os.session),
});
assert(deniedRun.status === 13, `wasm denied syscall status mismatch: ${deniedRun.status}`);
assert(!os.fs.exists("/root/wasm-denied.txt"), "wasm denied syscall mutated a root-owned path");
assert(os.fs.readFile("/var/log/dindbos/syscall.log").includes("fs.writeText EACCES"), "wasm denied syscall did not write EACCES trace");

const scopedWriteDenied = await os.wasm.runFile("/home/guest/bin/scoped-write.wasm", "/home/guest/bin", {
  principal: os.permissions.principal(os.session),
});
assert(scopedWriteDenied.status === 13, `wasm default scoped write status mismatch: ${scopedWriteDenied.status}`);
assert(!os.fs.exists("/home/guest/shared/wasm-scoped.txt"), "wasm default scope wrote outside executable directory");

const scopedWriteAllowed = await os.wasm.runFile("/home/guest/bin/scoped-write.wasm", "/home/guest/bin", {
  fileSystem: {
    read: ["/home/guest/bin"],
    write: ["/home/guest/shared"],
  },
  principal: os.permissions.principal(os.session),
});
assert(scopedWriteAllowed.status === 0, `wasm explicit scoped write status mismatch: ${scopedWriteAllowed.status}`);
assert(os.fs.readFile("/home/guest/shared/wasm-scoped.txt") === "scoped wasm", "wasm explicit scope did not write shared file");

const trapRun = await os.wasm.runFile("/home/guest/bin/trap.wasm", "/home/guest/bin", {
  principal: os.permissions.principal(os.session),
});
assert(trapRun.status === 1, `wasm trap status mismatch: ${trapRun.status}`);
assert(trapRun.crashed === true, "wasm trap did not report crashed=true");
assert(trapRun.crashReportPath === `/var/log/dindbos/crash-${trapRun.pid}.log`, `wasm trap crash path mismatch: ${trapRun.crashReportPath}`);
assert(os.fs.exists(trapRun.crashReportPath), "wasm trap crash report was not written");
assert(os.fs.readFile(trapRun.crashReportPath).includes("unreachable"), "wasm trap crash report missing trap message");
assert(os.fs.readFile("/var/log/dindbos/crashes.log").includes(`pid=${trapRun.pid} app=wasm:trap.wasm`), "wasm trap crash index missing pid/app");

const memoryLimitRun = await os.wasm.runFile("/home/guest/bin/hello.wasm", "/home/guest/bin", {
  maxMemoryPages: 0,
  principal: os.permissions.principal(os.session),
});
assert(memoryLimitRun.status === 1, `wasm memory limit status mismatch: ${memoryLimitRun.status}`);
assert(memoryLimitRun.crashed === true, "wasm memory limit did not report crashed=true");
assert(memoryLimitRun.stderr.includes("memory pages 1 exceed limit 0"), "wasm memory limit stderr missing page detail");
assert(os.fs.readFile(memoryLimitRun.crashReportPath).includes("memory pages 1 exceed limit 0"), "wasm memory limit crash report missing page detail");

const abortRun = await os.wasm.runFile("/home/guest/bin/deadline.wasm", "/home/guest/bin", {
  abortSignal: { aborted: true, reason: "smoke abort" },
  principal: os.permissions.principal(os.session),
});
assert(abortRun.status === 1, `wasm cooperative abort status mismatch: ${abortRun.status}`);
assert(abortRun.crashed === true, "wasm cooperative abort did not report crashed=true");
assert(abortRun.stderr.includes("wasm: aborted: smoke abort"), "wasm cooperative abort stderr missing reason");

const timeoutRun = await os.wasm.runFile("/home/guest/bin/slow-deadline.wasm", "/home/guest/bin", {
  timeoutMs: 1,
  deadlineAt: 0,
  principal: os.permissions.principal(os.session),
});
assert(timeoutRun.status === 1, `wasm cooperative timeout status mismatch: ${timeoutRun.status}`);
assert(timeoutRun.crashed === true, "wasm cooperative timeout did not report crashed=true");
assert(timeoutRun.stderr.includes("cooperative timeout after 1ms"), "wasm cooperative timeout stderr missing detail");

const growMemoryRun = await os.wasm.runFile("/home/guest/bin/grow-memory.wasm", "/home/guest/bin", {
  maxMemoryPages: 1,
  principal: os.permissions.principal(os.session),
});
assert(growMemoryRun.status === 1, `wasm grow memory limit status mismatch: ${growMemoryRun.status}`);
assert(growMemoryRun.crashed === true, "wasm grow memory limit did not report crashed=true");
assert(growMemoryRun.stderr.includes("memory pages 2 exceed limit 1"), "wasm grow memory limit stderr missing page detail");

const wasiRun = await os.wasm.runFile("/home/guest/bin/wasi-hello.wasm", "/home/guest/bin", {
  argv: ["wasi-hello.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiRun.status === 0, `wasi fd_write status mismatch: ${wasiRun.status} ${wasiRun.stderr}`);
assert(wasiRun.stdout === "wasi hello\n", `wasi fd_write stdout mismatch: ${JSON.stringify(wasiRun.stdout)}`);

const workerWasiRun = await os.wasm.runFile("/home/guest/bin/wasi-hello.wasm", "/home/guest/bin", {
  argv: ["wasi-hello.wasm"],
  executionBackend: "worker",
  principal: os.permissions.principal(os.session),
});
assert(workerWasiRun.status === 0, `worker wasi fd_write status mismatch: ${workerWasiRun.status} ${workerWasiRun.stderr}`);
assert(workerWasiRun.backend === "worker", `worker wasi backend mismatch: ${workerWasiRun.backend}`);
assert(workerWasiRun.stdout === "wasi hello\n", `worker wasi fd_write stdout mismatch: ${JSON.stringify(workerWasiRun.stdout)}`);
assert(os.processes.history.some((process) => process.appId === "wasm:wasi-hello.wasm" && process.executionBackend === "worker"), "worker wasm run was not tracked with worker backend");

const workerExitRun = await os.wasm.runFile("/home/guest/bin/exit7.wasm", "/home/guest/bin", {
  executionBackend: "worker",
  principal: os.permissions.principal(os.session),
});
assert(workerExitRun.status === 7, `worker wasm exit status mismatch: ${workerExitRun.status}`);

let workerMemoryLimitError = null;
try {
  await os.wasm.runFile("/home/guest/bin/hello.wasm", "/home/guest/bin", {
    executionBackend: "worker",
    maxMemoryPages: 0,
    principal: os.permissions.principal(os.session),
  });
} catch (error) {
  workerMemoryLimitError = error;
}
assert(workerMemoryLimitError?.code === "EIO", `worker wasm memory limit error code mismatch: ${workerMemoryLimitError?.code}`);
assert(String(workerMemoryLimitError?.message || "").includes("memory pages 1 exceed limit 0"), "worker wasm memory limit error missing page detail");

let workerAbortError = null;
try {
  await os.wasm.runFile("/home/guest/bin/deadline.wasm", "/home/guest/bin", {
    executionBackend: "worker",
    abortSignal: { aborted: true, reason: "worker smoke abort" },
    principal: os.permissions.principal(os.session),
  });
} catch (error) {
  workerAbortError = error;
}
assert(workerAbortError?.code === "EIO", `worker wasm cooperative abort error code mismatch: ${workerAbortError?.code}`);
assert(String(workerAbortError?.message || "").includes("wasm: aborted: worker smoke abort"), "worker wasm cooperative abort error missing reason");

let workerGrowMemoryError = null;
try {
  await os.wasm.runFile("/home/guest/bin/grow-memory.wasm", "/home/guest/bin", {
    executionBackend: "worker",
    maxMemoryPages: 1,
    principal: os.permissions.principal(os.session),
  });
} catch (error) {
  workerGrowMemoryError = error;
}
assert(workerGrowMemoryError?.code === "EIO", `worker wasm grow memory limit error code mismatch: ${workerGrowMemoryError?.code}`);
assert(String(workerGrowMemoryError?.message || "").includes("memory pages 2 exceed limit 1"), "worker wasm grow memory limit error missing page detail");

const wasiCatRun = await os.wasm.runFile("/home/guest/bin/wasi-cat.wasm", "/home/guest/bin", {
  argv: ["wasi-cat.wasm"],
  stdin: "stdin echo\n",
  principal: os.permissions.principal(os.session),
});
assert(wasiCatRun.status === 0, `wasi fd_read status mismatch: ${wasiCatRun.status} ${wasiCatRun.stderr}`);
assert(wasiCatRun.stdout === "stdin echo\n", `wasi fd_read stdout mismatch: ${JSON.stringify(wasiCatRun.stdout)}`);

result = await shell.executeAsync("echo pipe echo | /home/guest/bin/wasi-cat.wasm");
assert(result.status === 0, `shell pipeline wasi status mismatch: ${result.status} ${result.output}`);
assert(result.output === "pipe echo", `shell pipeline wasi output mismatch: ${JSON.stringify(result.output)}`);

const wasiOpenRead = await os.wasm.runFile("/home/guest/bin/wasi-open-read.wasm", "/home/guest/bin", {
  argv: ["wasi-open-read.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiOpenRead.status === 0, `wasi path_open read status mismatch: ${wasiOpenRead.status} ${wasiOpenRead.stderr}`);
assert(wasiOpenRead.stdout === "opened read\n", `wasi path_open read stdout mismatch: ${JSON.stringify(wasiOpenRead.stdout)}`);

const wasiOpenWrite = await os.wasm.runFile("/home/guest/bin/wasi-open-write.wasm", "/home/guest/bin", {
  argv: ["wasi-open-write.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiOpenWrite.status === 0, `wasi path_open write status mismatch: ${wasiOpenWrite.status} ${wasiOpenWrite.stderr}`);
assert(os.fs.readFile("/home/guest/bin/wasi-out.txt") === "opened write\n", "wasi path_open write did not persist file");

const beforeWasiFdSyncFlushes = storage.flushes;
const wasiSyncWrite = await os.wasm.runFile("/home/guest/bin/wasi-sync-write.wasm", "/home/guest/bin", {
  argv: ["wasi-sync-write.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiSyncWrite.status === 0, `wasi fd_sync status mismatch: ${wasiSyncWrite.status} ${wasiSyncWrite.stderr}`);
assert(os.fs.readFile("/home/guest/bin/wasi-sync-out.txt") === "synced write\n", "wasi fd_sync write did not persist file");
assert(storage.flushes > beforeWasiFdSyncFlushes, "wasi fd_sync did not wait for descriptor sync flush");

const wasiRights = await os.wasm.runFile("/home/guest/bin/wasi-rights.wasm", "/home/guest/bin", {
  argv: ["wasi-rights.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiRights.status === 8, `wasi read-only descriptor write did not return EBADF: ${wasiRights.status} ${wasiRights.stderr}`);

const wasiFilestat = await os.wasm.runFile("/home/guest/bin/wasi-filestat.wasm", "/home/guest/bin", {
  argv: ["wasi-filestat.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiFilestat.status === 0, `wasi filestat status mismatch: ${wasiFilestat.status} ${wasiFilestat.stderr}`);

const wasiReaddir = await os.wasm.runFile("/home/guest/bin/wasi-readdir.wasm", "/home/guest/bin", {
  argv: ["wasi-readdir.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiReaddir.status === 0, `wasi fd_readdir status mismatch: ${wasiReaddir.status} ${wasiReaddir.stderr}`);

const wasiMkdir = await os.wasm.runFile("/home/guest/bin/wasi-mkdir.wasm", "/home/guest/bin", {
  argv: ["wasi-mkdir.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiMkdir.status === 0, `wasi path_create_directory status mismatch: ${wasiMkdir.status} ${wasiMkdir.stderr}`);
assert(os.fs.stat("/home/guest/bin/wasi-made-dir")?.type === "directory", "wasi path_create_directory did not create directory");

const wasiRemove = await os.wasm.runFile("/home/guest/bin/wasi-remove.wasm", "/home/guest/bin", {
  argv: ["wasi-remove.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiRemove.status === 0, `wasi path remove status mismatch: ${wasiRemove.status} ${wasiRemove.stderr}`);
assert(!os.fs.exists("/home/guest/bin/wasi-delete.txt"), "wasi path_unlink_file did not remove file");
assert(!os.fs.exists("/home/guest/bin/wasi-remove-dir"), "wasi path_remove_directory did not remove directory");

const wasiRename = await os.wasm.runFile("/home/guest/bin/wasi-rename.wasm", "/home/guest/bin", {
  argv: ["wasi-rename.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiRename.status === 0, `wasi path_rename status mismatch: ${wasiRename.status} ${wasiRename.stderr}`);
assert(!os.fs.exists("/home/guest/bin/wasi-rename-from.txt"), "wasi path_rename left source file in place");
assert(os.fs.readFile("/home/guest/bin/wasi-renamed.txt") === "rename me\n", "wasi path_rename did not preserve file content");
assert(!os.fs.exists("/home/guest/bin/wasi-rename-dir"), "wasi path_rename left source directory in place");
assert(os.fs.stat("/home/guest/bin/wasi-renamed-dir")?.type === "directory", "wasi path_rename did not rename directory");

const wasiSymlink = await os.wasm.runFile("/home/guest/bin/wasi-symlink.wasm", "/home/guest/bin", {
  argv: ["wasi-symlink.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiSymlink.status === 0, `wasi path_symlink/readlink status mismatch: ${wasiSymlink.status} ${wasiSymlink.stderr}`);
assert(wasiSymlink.stdout === "wasi-symlink-target.txt", `wasi path_readlink stdout mismatch: ${JSON.stringify(wasiSymlink.stdout)}`);
assert(os.fs.lstat("/home/guest/bin/wasi-link.txt")?.type === "link", "wasi path_symlink did not create a link node");
assert(os.fs.readlink("/home/guest/bin/wasi-link.txt") === "wasi-symlink-target.txt", "wasi readlink target mismatch");
assert(os.fs.readFile("/home/guest/bin/wasi-link.txt") === "through symlink\n", "wasi symlink did not resolve to target file content");

const wasiHardLink = await os.wasm.runFile("/home/guest/bin/wasi-hardlink.wasm", "/home/guest/bin", {
  argv: ["wasi-hardlink.wasm"],
  principal: os.permissions.principal(os.session),
});
assert(wasiHardLink.status === 0, `wasi path_link status mismatch: ${wasiHardLink.status} ${wasiHardLink.stderr}`);
assert(os.fs.readFile("/home/guest/bin/wasi-hardlink.txt") === "linked data\n", "wasi path_link did not preserve file content");
assert(os.fs.stat("/home/guest/bin/wasi-hardlink-source.txt")?.linkCount === 2, "wasi path_link source link count mismatch");
assert(os.fs.stat("/home/guest/bin/wasi-hardlink.txt")?.linkCount === 2, "wasi path_link destination link count mismatch");
os.fs.writeFile("/home/guest/bin/wasi-hardlink.txt", "changed through link\n", "/", os.permissions.principal(os.session));
assert(os.fs.readFile("/home/guest/bin/wasi-hardlink-source.txt") === "changed through link\n", "wasi hard link did not share writes with source");
os.fs.remove("/home/guest/bin/wasi-hardlink-source.txt", "/", {}, os.permissions.principal(os.session));
assert(os.fs.readFile("/home/guest/bin/wasi-hardlink.txt") === "changed through link\n", "wasi hard link did not survive source removal");
assert(os.fs.stat("/home/guest/bin/wasi-hardlink.txt")?.linkCount === 1, "wasi hard link count did not update after source removal");

console.log("wasm smoke ok shell argv env syscall async-sync exit permission scopes crash memory deadline grow wasi fd-sync worker stdin path-open rights filestat readdir mkdir remove rename symlink hardlink process");

function helloWasm() {
  const data = bytes("hello \nuser=USER\n");
  return wasmModule({
    types: [
      { params: ["i32", "i32"], results: [] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { name: "write", type: 0 },
      { name: "writeArg", type: 1 },
      { name: "writeEnv", type: 0 },
    ],
    startType: 2,
    body: [
      0x41, 0x00, 0x41, 0x06, 0x10, 0x00,
      0x41, 0x00, 0x10, 0x01,
      0x41, 0x06, 0x41, 0x06, 0x10, 0x00,
      0x41, 0x0c, 0x41, 0x04, 0x10, 0x02,
      0x41, 0x10, 0x41, 0x01, 0x10, 0x00,
      0x0b,
    ],
    data,
  });
}

function syscallWriteWasm() {
  const request = bytes(JSON.stringify({
    name: "fs.writeText",
    args: { path: "wasm-syscall.txt", content: "from wasm syscall" },
  }));
  return wasmModule({
    types: [
      { params: ["i32", "i32"], results: ["i32"] },
      { params: [], results: [] },
    ],
    imports: [{ name: "syscall", type: 0 }],
    startType: 1,
    body: [
      0x41, 0x00, 0x41, ...i32(request.length), 0x10, 0x00, 0x1a,
      0x0b,
    ],
    data: request,
  });
}

function syscallAsyncStorageSyncWasm() {
  const request = bytes(JSON.stringify({
    name: "storage.sync",
    args: {},
  }));
  return wasmModule({
    types: [
      { params: ["i32", "i32"], results: ["i32"] },
      { params: [], results: ["i32"] },
    ],
    imports: [{ name: "syscallAsync", type: 0 }],
    startType: 1,
    body: [
      0x41, 0x00, 0x41, ...i32(request.length), 0x10, 0x00,
      0x0b,
    ],
    data: request,
  });
}

function exitWasm() {
  return wasmModule({
    types: [
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [{ name: "exit", type: 0 }],
    startType: 1,
    body: [0x41, 0x07, 0x10, 0x00, 0x0b],
    data: new Uint8Array(),
  });
}

function deniedWriteWasm() {
  const request = bytes(JSON.stringify({
    name: "fs.writeText",
    args: { path: "/root/wasm-denied.txt", content: "denied" },
  }));
  return wasmModule({
    types: [
      { params: ["i32", "i32"], results: ["i32"] },
      { params: [], results: ["i32"] },
    ],
    imports: [{ name: "syscall", type: 0 }],
    startType: 1,
    body: [
      0x41, 0x00, 0x41, ...i32(request.length), 0x10, 0x00,
      0x0b,
    ],
    data: request,
  });
}

function scopedWriteWasm() {
  const request = bytes(JSON.stringify({
    name: "fs.writeText",
    args: { path: "/home/guest/shared/wasm-scoped.txt", content: "scoped wasm" },
  }));
  return wasmModule({
    types: [
      { params: ["i32", "i32"], results: ["i32"] },
      { params: [], results: ["i32"] },
    ],
    imports: [{ name: "syscall", type: 0 }],
    startType: 1,
    body: [
      0x41, 0x00, 0x41, ...i32(request.length), 0x10, 0x00,
      0x0b,
    ],
    data: request,
  });
}

function trapWasm() {
  return wasmModule({
    types: [
      { params: [], results: [] },
    ],
    imports: [],
    startType: 0,
    body: [0x00, 0x0b],
    data: new Uint8Array(),
  });
}

function deadlineWasm(nopCount = 0) {
  return wasmModule({
    types: [
      { params: [], results: ["i32"] },
      { params: [], results: ["i32"] },
    ],
    imports: [{ name: "checkDeadline", type: 0 }],
    startType: 1,
    body: [
      ...Array.from({ length: nopCount }, () => 0x01),
      0x10, 0x00,
      0x0b,
    ],
    data: new Uint8Array(),
  });
}

function growMemoryWasm() {
  return wasmModule({
    types: [
      { params: [], results: ["i32"] },
      { params: [], results: ["i32"] },
    ],
    imports: [{ name: "checkDeadline", type: 0 }],
    startType: 1,
    body: [
      0x41, 0x01, 0x40, 0x00, 0x1a,
      0x10, 0x00,
      0x0b,
    ],
    data: new Uint8Array(),
  });
}

function wasiHelloWasm() {
  const text = bytes("wasi hello\n");
  const iovOffset = 16;
  const writtenOffset = 32;
  const data = new Uint8Array(40);
  data.set(text, 0);
  data.set(u32le(0), iovOffset);
  data.set(u32le(text.length), iovOffset + 4);
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "fd_write", type: 0 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 1 },
    ],
    startType: 2,
    body: [
      0x41, 0x01, 0x41, iovOffset, 0x41, 0x01, 0x41, writtenOffset, 0x10, 0x00, 0x1a,
      0x41, 0x00, 0x10, 0x01,
      0x0b,
    ],
    data,
  });
}

function wasiCatWasm() {
  const readIovOffset = 16;
  const writeIovOffset = 24;
  const readCountOffset = 40;
  const writtenOffset = 44;
  const bufferOffset = 64;
  const bufferLength = 64;
  const data = new Uint8Array(bufferOffset + bufferLength);
  data.set(u32le(bufferOffset), readIovOffset);
  data.set(u32le(bufferLength), readIovOffset + 4);
  data.set(u32le(bufferOffset), writeIovOffset);
  data.set(u32le(0), writeIovOffset + 4);
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "fd_read", type: 0 },
      { module: "wasi_snapshot_preview1", name: "fd_write", type: 0 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 1 },
    ],
    startType: 2,
    body: [
      0x41, 0x00, 0x41, readIovOffset, 0x41, 0x01, 0x41, readCountOffset, 0x10, 0x00, 0x1a,
      0x41, writeIovOffset + 4, 0x41, readCountOffset, 0x28, 0x02, 0x00, 0x36, 0x02, 0x00,
      0x41, 0x01, 0x41, writeIovOffset, 0x41, 0x01, 0x41, writtenOffset, 0x10, 0x01, 0x1a,
      0x41, 0x00, 0x10, 0x02,
      0x0b,
    ],
    data,
  });
}

function wasiOpenReadWasm() {
  const path = bytes("wasi-file.txt");
  const readIovOffset = 32;
  const writeIovOffset = 40;
  const fdOffset = 56;
  const readCountOffset = 60;
  const writtenOffset = 64;
  const bufferOffset = 96;
  const bufferLength = 64;
  const data = new Uint8Array(bufferOffset + bufferLength);
  data.set(path, 0);
  data.set(u32le(bufferOffset), readIovOffset);
  data.set(u32le(bufferLength), readIovOffset + 4);
  data.set(u32le(bufferOffset), writeIovOffset);
  data.set(u32le(0), writeIovOffset + 4);
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32", "i32", "i32", "i64", "i64", "i32", "i32"], results: ["i32"] },
      { params: ["i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "path_open", type: 0 },
      { module: "wasi_snapshot_preview1", name: "fd_read", type: 1 },
      { module: "wasi_snapshot_preview1", name: "fd_write", type: 1 },
      { module: "wasi_snapshot_preview1", name: "fd_close", type: 2 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 3 },
    ],
    startType: 4,
    body: [
      0x41, 0x03, 0x41, 0x00, 0x41, 0x00, 0x41, ...i32(path.length), 0x41, 0x00, 0x42, 0x00, 0x42, 0x00, 0x41, 0x00, 0x41, ...i32(fdOffset), 0x10, 0x00, 0x1a,
      0x41, ...i32(fdOffset), 0x28, 0x02, 0x00, 0x41, ...i32(readIovOffset), 0x41, 0x01, 0x41, ...i32(readCountOffset), 0x10, 0x01, 0x1a,
      0x41, ...i32(writeIovOffset + 4), 0x41, ...i32(readCountOffset), 0x28, 0x02, 0x00, 0x36, 0x02, 0x00,
      0x41, 0x01, 0x41, ...i32(writeIovOffset), 0x41, 0x01, 0x41, ...i32(writtenOffset), 0x10, 0x02, 0x1a,
      0x41, ...i32(fdOffset), 0x28, 0x02, 0x00, 0x10, 0x03, 0x1a,
      0x41, 0x00, 0x10, 0x04,
      0x0b,
    ],
    data,
  });
}

function wasiOpenWriteWasm() {
  const path = bytes("wasi-out.txt");
  const content = bytes("opened write\n");
  const contentOffset = 32;
  const iovOffset = 64;
  const fdOffset = 80;
  const writtenOffset = 84;
  const data = new Uint8Array(96);
  data.set(path, 0);
  data.set(content, contentOffset);
  data.set(u32le(contentOffset), iovOffset);
  data.set(u32le(content.length), iovOffset + 4);
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32", "i32", "i32", "i64", "i64", "i32", "i32"], results: ["i32"] },
      { params: ["i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "path_open", type: 0 },
      { module: "wasi_snapshot_preview1", name: "fd_write", type: 1 },
      { module: "wasi_snapshot_preview1", name: "fd_close", type: 2 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 3 },
    ],
    startType: 4,
    body: [
      0x41, 0x03, 0x41, 0x00, 0x41, 0x00, 0x41, ...i32(path.length), 0x41, 0x09, 0x42, 0x00, 0x42, 0x00, 0x41, 0x00, 0x41, ...i32(fdOffset), 0x10, 0x00, 0x1a,
      0x41, ...i32(fdOffset), 0x28, 0x02, 0x00, 0x41, ...i32(iovOffset), 0x41, 0x01, 0x41, ...i32(writtenOffset), 0x10, 0x01, 0x1a,
      0x41, ...i32(fdOffset), 0x28, 0x02, 0x00, 0x10, 0x02, 0x1a,
      0x41, 0x00, 0x10, 0x03,
      0x0b,
    ],
    data,
  });
}

function wasiSyncWriteWasm() {
  const path = bytes("wasi-sync-out.txt");
  const content = bytes("synced write\n");
  const contentOffset = 32;
  const iovOffset = 64;
  const fdOffset = 80;
  const writtenOffset = 84;
  const data = new Uint8Array(96);
  data.set(path, 0);
  data.set(content, contentOffset);
  data.set(u32le(contentOffset), iovOffset);
  data.set(u32le(content.length), iovOffset + 4);
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32", "i32", "i32", "i64", "i64", "i32", "i32"], results: ["i32"] },
      { params: ["i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "path_open", type: 0 },
      { module: "wasi_snapshot_preview1", name: "fd_write", type: 1 },
      { module: "wasi_snapshot_preview1", name: "fd_sync", type: 2 },
      { module: "wasi_snapshot_preview1", name: "fd_close", type: 2 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 3 },
    ],
    startType: 4,
    body: [
      0x41, 0x03, 0x41, 0x00, 0x41, 0x00, 0x41, ...i32(path.length), 0x41, 0x09, 0x42, 0x00, 0x42, 0x00, 0x41, 0x00, 0x41, ...i32(fdOffset), 0x10, 0x00, 0x1a,
      0x41, ...i32(fdOffset), 0x28, 0x02, 0x00, 0x41, ...i32(iovOffset), 0x41, 0x01, 0x41, ...i32(writtenOffset), 0x10, 0x01, 0x1a,
      0x41, ...i32(fdOffset), 0x28, 0x02, 0x00, 0x10, 0x02, 0x1a,
      0x41, ...i32(fdOffset), 0x28, 0x02, 0x00, 0x10, 0x03, 0x1a,
      0x41, 0x00, 0x10, 0x04,
      0x0b,
    ],
    data,
  });
}

function wasiRightsWasm() {
  const path = bytes("wasi-file.txt");
  const content = bytes("blocked\n");
  const contentOffset = 32;
  const iovOffset = 64;
  const fdOffset = 80;
  const writtenOffset = 84;
  const data = new Uint8Array(96);
  data.set(path, 0);
  data.set(content, contentOffset);
  data.set(u32le(contentOffset), iovOffset);
  data.set(u32le(content.length), iovOffset + 4);
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32", "i32", "i32", "i64", "i64", "i32", "i32"], results: ["i32"] },
      { params: ["i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "path_open", type: 0 },
      { module: "wasi_snapshot_preview1", name: "fd_write", type: 1 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 2 },
    ],
    startType: 3,
    body: [
      0x41, 0x03, 0x41, 0x00, 0x41, 0x00, 0x41, ...i32(path.length), 0x41, 0x00, 0x42, ...i64(2n), 0x42, 0x00, 0x41, 0x00, 0x41, ...i32(fdOffset), 0x10, 0x00, 0x1a,
      0x41, ...i32(fdOffset), 0x28, 0x02, 0x00, 0x41, ...i32(iovOffset), 0x41, 0x01, 0x41, ...i32(writtenOffset), 0x10, 0x01,
      0x10, 0x02,
      0x0b,
    ],
    data,
  });
}

function wasiFilestatWasm() {
  const path = bytes("wasi-file.txt");
  const openedFdOffset = 32;
  const pathStatOffset = 64;
  const fdStatOffset = 128;
  const preopenFdstatOffset = 192;
  const fileFdstatOffset = 224;
  const data = new Uint8Array(256);
  data.set(path, 0);
  const typeAndSizeMatch = (offset) => [
    0x41, ...i32(offset + 16), 0x2d, 0x00, 0x00, 0x41, 0x04, 0x46,
    0x41, ...i32(offset + 32), 0x29, 0x03, 0x00, 0x42, 0x0c, 0x51,
    0x71,
  ];
  const fdstatMatches = (offset, filetype) => [
    0x41, ...i32(offset), 0x2d, 0x00, 0x00, 0x41, filetype, 0x46,
    0x41, ...i32(offset + 8), 0x29, 0x03, 0x00, 0x42, 0x02, 0x83, 0x50, 0x45,
    0x71,
  ];
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32", "i32", "i32", "i32", "i32", "i64", "i64", "i32", "i32"], results: ["i32"] },
      { params: ["i32", "i32"], results: ["i32"] },
      { params: [], results: ["i32"] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "path_filestat_get", type: 0 },
      { module: "wasi_snapshot_preview1", name: "path_open", type: 1 },
      { module: "wasi_snapshot_preview1", name: "fd_filestat_get", type: 2 },
      { module: "wasi_snapshot_preview1", name: "fd_fdstat_get", type: 2 },
    ],
    startType: 3,
    body: [
      0x41, 0x03, 0x41, 0x00, 0x41, 0x00, 0x41, ...i32(path.length), 0x41, ...i32(pathStatOffset), 0x10, 0x00, 0x1a,
      0x41, 0x03, 0x41, 0x00, 0x41, 0x00, 0x41, ...i32(path.length), 0x41, 0x00, 0x42, 0x02, 0x42, 0x00, 0x41, 0x00, 0x41, ...i32(openedFdOffset), 0x10, 0x01, 0x1a,
      0x41, ...i32(openedFdOffset), 0x28, 0x02, 0x00, 0x41, ...i32(fdStatOffset), 0x10, 0x02, 0x1a,
      0x41, 0x03, 0x41, ...i32(preopenFdstatOffset), 0x10, 0x03, 0x1a,
      0x41, ...i32(openedFdOffset), 0x28, 0x02, 0x00, 0x41, ...i32(fileFdstatOffset), 0x10, 0x03, 0x1a,
      ...typeAndSizeMatch(pathStatOffset),
      ...typeAndSizeMatch(fdStatOffset),
      ...fdstatMatches(preopenFdstatOffset, 0x03),
      0x71,
      ...fdstatMatches(fileFdstatOffset, 0x04),
      0x71,
      0x71,
      0x45,
      0x0b,
    ],
    data,
  });
}

function wasiReaddirWasm() {
  const nreadOffset = 16;
  const bufferOffset = 32;
  const bufferLength = 192;
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32", "i64", "i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "fd_readdir", type: 0 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 1 },
    ],
    startType: 2,
    body: [
      0x41, 0x03, 0x41, bufferOffset, 0x41, ...i32(bufferLength), 0x42, 0x00, 0x41, nreadOffset, 0x10, 0x00, 0x1a,
      0x41, nreadOffset, 0x28, 0x02, 0x00, 0x45,
      0x04, 0x40,
      0x41, 0x01, 0x10, 0x01,
      0x0b,
      0x41, 0x00, 0x10, 0x01,
      0x0b,
    ],
    data: new Uint8Array(),
  });
}

function wasiMkdirWasm() {
  const path = bytes("wasi-made-dir");
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "path_create_directory", type: 0 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 1 },
    ],
    startType: 2,
    body: [
      0x41, 0x03, 0x41, 0x00, 0x41, ...i32(path.length), 0x10, 0x00,
      0x10, 0x01,
      0x0b,
    ],
    data: path,
  });
}

function wasiRemoveWasm() {
  const filePath = bytes("wasi-delete.txt");
  const dirPath = bytes("wasi-remove-dir");
  const dirOffset = 32;
  const data = new Uint8Array(64);
  data.set(filePath, 0);
  data.set(dirPath, dirOffset);
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "path_unlink_file", type: 0 },
      { module: "wasi_snapshot_preview1", name: "path_remove_directory", type: 0 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 1 },
    ],
    startType: 2,
    body: [
      0x41, 0x03, 0x41, 0x00, 0x41, ...i32(filePath.length), 0x10, 0x00, 0x1a,
      0x41, 0x03, 0x41, dirOffset, 0x41, ...i32(dirPath.length), 0x10, 0x01,
      0x10, 0x02,
      0x0b,
    ],
    data,
  });
}

function wasiRenameWasm() {
  const fileFrom = bytes("wasi-rename-from.txt");
  const fileTo = bytes("wasi-renamed.txt");
  const dirFrom = bytes("wasi-rename-dir");
  const dirTo = bytes("wasi-renamed-dir");
  const fileToOffset = 32;
  const dirFromOffset = 64;
  const dirToOffset = 96;
  const data = new Uint8Array(128);
  data.set(fileFrom, 0);
  data.set(fileTo, fileToOffset);
  data.set(dirFrom, dirFromOffset);
  data.set(dirTo, dirToOffset);
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "path_rename", type: 0 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 1 },
    ],
    startType: 2,
    body: [
      0x41, 0x03, 0x41, 0x00, 0x41, ...i32(fileFrom.length), 0x41, 0x03, 0x41, ...i32(fileToOffset), 0x41, ...i32(fileTo.length), 0x10, 0x00, 0x1a,
      0x41, 0x03, 0x41, ...i32(dirFromOffset), 0x41, ...i32(dirFrom.length), 0x41, 0x03, 0x41, ...i32(dirToOffset), 0x41, ...i32(dirTo.length), 0x10, 0x00,
      0x10, 0x01,
      0x0b,
    ],
    data,
  });
}

function wasiSymlinkWasm() {
  const target = bytes("wasi-symlink-target.txt");
  const linkPath = bytes("wasi-link.txt");
  const linkOffset = 32;
  const iovOffset = 64;
  const bufferOffset = 80;
  const nreadOffset = 124;
  const nwrittenOffset = 128;
  const data = new Uint8Array(160);
  data.set(target, 0);
  data.set(linkPath, linkOffset);
  data.set(u32le(bufferOffset), iovOffset);
  data.set(u32le(target.length), iovOffset + 4);
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32", "i32", "i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "path_symlink", type: 0 },
      { module: "wasi_snapshot_preview1", name: "path_readlink", type: 1 },
      { module: "wasi_snapshot_preview1", name: "fd_write", type: 2 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 3 },
    ],
    startType: 4,
    body: [
      0x41, 0x00, 0x41, ...i32(target.length), 0x41, 0x03, 0x41, ...i32(linkOffset), 0x41, ...i32(linkPath.length), 0x10, 0x00, 0x1a,
      0x41, 0x03, 0x41, ...i32(linkOffset), 0x41, ...i32(linkPath.length), 0x41, ...i32(bufferOffset), 0x41, ...i32(target.length), 0x41, ...i32(nreadOffset), 0x10, 0x01, 0x1a,
      0x41, 0x01, 0x41, ...i32(iovOffset), 0x41, 0x01, 0x41, ...i32(nwrittenOffset), 0x10, 0x02,
      0x10, 0x03,
      0x0b,
    ],
    data,
  });
}

function wasiHardLinkWasm() {
  const source = bytes("wasi-hardlink-source.txt");
  const destination = bytes("wasi-hardlink.txt");
  const destinationOffset = 32;
  const data = new Uint8Array(64);
  data.set(source, 0);
  data.set(destination, destinationOffset);
  return wasmModule({
    types: [
      { params: ["i32", "i32", "i32", "i32", "i32", "i32", "i32"], results: ["i32"] },
      { params: ["i32"], results: [] },
      { params: [], results: [] },
    ],
    imports: [
      { module: "wasi_snapshot_preview1", name: "path_link", type: 0 },
      { module: "wasi_snapshot_preview1", name: "proc_exit", type: 1 },
    ],
    startType: 2,
    body: [
      0x41, 0x03, 0x41, 0x00, 0x41, 0x00, 0x41, ...i32(source.length), 0x41, 0x03, 0x41, ...i32(destinationOffset), 0x41, ...i32(destination.length), 0x10, 0x00,
      0x10, 0x01,
      0x0b,
    ],
    data,
  });
}

function wasmModule({ types, imports, startType, body, data }) {
  const importCount = imports.length;
  const sections = [
    section(1, [types.length, ...types.flatMap(typeBytes)]),
    section(2, [imports.length, ...imports.flatMap((entry) => [...stringBytes(entry.module || "dindbos"), ...stringBytes(entry.name), 0x00, ...u32(entry.type)])]),
    section(3, [0x01, ...u32(startType)]),
    section(5, [0x01, 0x00, 0x01]),
    section(7, [
      0x02,
      ...stringBytes("memory"), 0x02, 0x00,
      ...stringBytes("_start"), 0x00, ...u32(importCount),
    ]),
    section(10, [0x01, ...vec([0x00, ...body])]),
  ];
  if (data.length) sections.push(section(11, [0x01, 0x00, 0x41, 0x00, 0x0b, ...u32(data.length), ...data]));
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...sections.flat()]);
}

function typeBytes(type) {
  return [0x60, type.params.length, ...type.params.map(valueType), type.results.length, ...type.results.map(valueType)];
}

function valueType(value) {
  if (value === "i32") return 0x7f;
  if (value === "i64") return 0x7e;
  throw new Error(`unsupported wasm value type: ${value}`);
}

function section(id, payload) {
  return [id, ...u32(payload.length), ...payload];
}

function vec(payload) {
  return [...u32(payload.length), ...payload];
}

function stringBytes(value) {
  const encoded = bytes(value);
  return [...u32(encoded.length), ...encoded];
}

function bytes(value) {
  return new TextEncoder().encode(String(value));
}

function u32(value) {
  const out = [];
  let cursor = Number(value >>> 0);
  do {
    let byte = cursor & 0x7f;
    cursor >>>= 7;
    if (cursor) byte |= 0x80;
    out.push(byte);
  } while (cursor);
  return out;
}

function i32(value) {
  const out = [];
  let cursor = Number(value | 0);
  let more = true;
  while (more) {
    let byte = cursor & 0x7f;
    cursor >>= 7;
    const signBit = byte & 0x40;
    more = !((cursor === 0 && signBit === 0) || (cursor === -1 && signBit !== 0));
    if (more) byte |= 0x80;
    out.push(byte);
  }
  return out;
}

function i64(value) {
  const out = [];
  let cursor = BigInt(value);
  let more = true;
  while (more) {
    let byte = Number(cursor & 0x7fn);
    cursor >>= 7n;
    const signBit = byte & 0x40;
    more = !((cursor === 0n && signBit === 0) || (cursor === -1n && signBit !== 0));
    if (more) byte |= 0x80;
    out.push(byte);
  }
  return out;
}

function u32le(value) {
  const number = Number(value >>> 0);
  return new Uint8Array([
    number & 0xff,
    (number >> 8) & 0xff,
    (number >> 16) & 0xff,
    (number >> 24) & 0xff,
  ]);
}

function memoryStorage() {
  let flushes = 0;
  return {
    async loadFileSystem() {
      return null;
    },
    saveFileSystem() {},
    async flush() {
      flushes += 1;
      return { flushed: true, flushes };
    },
    get flushes() {
      return flushes;
    },
    status: () => ({ backend: "memory", bytes: 0 }),
    estimate: async () => ({ backend: "memory", bytes: 0 }),
    resetFileSystem() {},
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
