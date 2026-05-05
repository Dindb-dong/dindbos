# DindbOS WASM Runtime

DindbOS can run small WebAssembly modules from the VFS as browser-native user processes.

This is an early DindbOS ABI runner, not full WASI yet. Modules run through `WebAssembly.instantiate`, get a process record, and use the `dindbos` import namespace for stdout, argv/env helpers, syscall calls, and exit status. A small `wasi_snapshot_preview1` import subset is also available for basic CLI-style programs.

## Shell Usage

```text
chmod 755 /home/guest/bin/hello.wasm
/home/guest/bin/hello.wasm max
wasm /home/guest/bin/hello.wasm max
```

Executable `.wasm` files can be launched directly through the shell when the execute bit is set. The `wasm` command is the explicit form.

Package apps can also use WASM entry points by declaring `"runtime": "wasm"` or an `.wasm` `app.entry` in `dindbos.app.json`. AppRegistry launches the package window, then the package manager runs the WASM entry through the same runner with the package's declared filesystem and capability scopes.

Toolchain notes for C, Rust, Zig, and TinyGo examples are in [wasm-toolchains.md](./wasm-toolchains.md).

## Imports

Current modules can import from `dindbos`:

```text
write(ptr, len)
writeErr(ptr, len)
argc() -> i32
writeArg(index)
writeEnv(ptr, len)
syscall(ptr, len) -> i32
checkDeadline() -> i32
exit(code)
```

`write`, `writeErr`, `writeEnv`, and `syscall` read bytes from exported module memory. `checkDeadline()` is a cooperative execution guard: modules that call it periodically will crash through the DindbOS process crash path when `timeoutMs` has expired or the run was started with an aborted signal. `syscall(ptr, len)` expects a JSON request such as:

```json
{
  "name": "fs.writeText",
  "args": {
    "path": "note.txt",
    "content": "hello"
  }
}
```

It returns `0` on success or an errno-style number for failure. The structured syscall result is still recorded through DindbOS syscall tracing.

Current modules can also import these WASI-style functions from `wasi_snapshot_preview1`:

```text
args_sizes_get(argcPtr, argvBufSizePtr) -> errno
args_get(argvPtr, argvBufPtr) -> errno
environ_sizes_get(environCountPtr, environBufSizePtr) -> errno
environ_get(environPtr, environBufPtr) -> errno
fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) -> errno
fd_read(fd, iovsPtr, iovsLen, nreadPtr) -> errno
fd_close(fd) -> errno
fd_fdstat_get(fd, resultPtr) -> errno
fd_filestat_get(fd, resultPtr) -> errno
fd_readdir(fd, bufPtr, bufLen, cookie, nreadPtr) -> errno
path_create_directory(dirfd, pathPtr, pathLen) -> errno
path_unlink_file(dirfd, pathPtr, pathLen) -> errno
path_remove_directory(dirfd, pathPtr, pathLen) -> errno
path_rename(oldDirfd, oldPathPtr, oldPathLen, newDirfd, newPathPtr, newPathLen) -> errno
path_symlink(targetPtr, targetLen, dirfd, pathPtr, pathLen) -> errno
path_readlink(dirfd, pathPtr, pathLen, bufferPtr, bufferLen, nreadPtr) -> errno
path_link(oldDirfd, oldFlags, oldPathPtr, oldPathLen, newDirfd, newPathPtr, newPathLen) -> errno
path_filestat_get(dirfd, flags, pathPtr, pathLen, resultPtr) -> errno
path_open(dirfd, dirflags, pathPtr, pathLen, oflags, rightsBase, rightsInheriting, fdflags, openedFdPtr) -> errno
fd_prestat_get(fd, resultPtr) -> errno
fd_prestat_dir_name(fd, pathPtr, pathLen) -> errno
proc_exit(code)
random_get(ptr, len) -> errno
clock_time_get(id, precision, resultPtr) -> errno
```

`fd_write` currently writes through the shared DindbOS descriptor table for descriptor `1` stdout and descriptor `2` stderr. `fd_read` reads through the same table, including stdin data supplied by shell pipelines and `runFile({ stdin })`. WASI programs receive a preopened cwd descriptor and can use `path_open` for scoped VFS file read/write. `path_open` honors first-pass `rightsBase` read/write rights by mapping them onto descriptor read/write permission checks. `fd_fdstat_get` exposes descriptor file type, append flag, and first-pass read/write rights. `fd_filestat_get` and `path_filestat_get` expose first-pass VFS type, size, link count, timestamp, and stable inode metadata. `fd_readdir` can enumerate directory descriptors such as the preopened cwd; `path_create_directory`, `path_unlink_file`, `path_remove_directory`, `path_rename`, `path_symlink`, `path_readlink`, and `path_link` provide first-pass directory mutation and link metadata under scoped directory descriptors. Full pseudo-terminal behavior remains roadmap work.

## Process Model

Each run spawns a process with an app id like `wasm:hello.wasm`. The process receives argv, cwd, a browser-native environment, and a manifest-scoped filesystem policy rooted at the executable directory for first-pass shell runs.

When the module exits, DindbOS records the process lifecycle and removes the running process entry. Crash paths report stderr, return `crashed: true` plus `crashReportPath`, and flow through the runtime process crash path under `/var/log/dindbos/crash-<pid>.log`.

`runFile(path, cwd, { executionBackend: "worker" })` can run stdout/stderr-only DindbOS ABI and basic WASI modules through `ProcessExecutor`'s worker backend. That path keeps WebAssembly instantiation and execution off the main runtime thread, records `executionBackend: "worker"` in process history and `/proc`, and returns stdout, stderr, and exit status through the executor output buffer. This is a first-pass isolation path for output-only modules; syscall-heavy WASM still runs on the main-thread runner until the WASM ABI can target the worker syscall bridge safely.

`runFile(path, cwd, { maxMemoryPages })` adds a first-pass memory guard. When the module exports memory and the current page count is greater than the configured limit, DindbOS stops the run before `_start`, marks the process as crashed, and records the page-limit reason in the crash report. The same guard is also passed to the worker output backend.

`runFile(path, cwd, { timeoutMs, abortSignal })` can be enforced cooperatively by modules that import and call `dindbos.checkDeadline()`. The same call also rechecks `maxMemoryPages`, so modules that grow exported memory after `_start` can opt into grow-time limit enforcement. The main runner and worker output backend both route timeout, abort, and grow-limit failures through normal process crash handling.

Direct `runFile` callers can broaden a process beyond the executable-directory default by passing `fileSystem: { read, write }` and `capabilities`. These scopes are copied into the spawned WASM process manifest before syscall checks run, so explicit VFS access behaves the same way as package-declared WASM access.

## Current Limits

- no full WASI import surface yet
- no full pseudo-terminal sessions yet
- no broad WASI metadata edge-case coverage yet
- worker isolation currently covers stdout/stderr-only DindbOS ABI and basic WASI modules, not syscall-heavy WASM
- timeout, abort, and grow-time memory guards are cooperative after `_start`, so modules must call `checkDeadline()`

## Verification

```bash
npm run smoke:wasm
```

The smoke verifies shell execution, argv/env output, syscall-backed file write, denied syscall EACCES tracing, explicit filesystem scope broadening for direct `runFile` calls, trap crash report capture, `maxMemoryPages` crash handling, cooperative `checkDeadline()` timeout/abort/grow-limit handling, basic WASI `fd_write`/`fd_read`/`fd_fdstat_get`/`fd_filestat_get`/`fd_readdir`/`path_create_directory`/`path_unlink_file`/`path_remove_directory`/`path_rename`/`path_symlink`/`path_readlink`/`path_link`/`path_filestat_get`/`path_open`/`fd_close`/`proc_exit`, worker-backed WASM stdout/status/process backend tracking plus memory-limit, abort, and grow-limit denial, stdin pipeline delivery, VFS file read/write through opened WASI descriptors, read-only `rightsBase` denial for descriptor writes, nonzero exit status, and process tracking for `.wasm` files. `npm run smoke:packages` verifies install and AppRegistry launch for a WASM-backed package app.
