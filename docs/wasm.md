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

## Imports

Current modules can import from `dindbos`:

```text
write(ptr, len)
writeErr(ptr, len)
argc() -> i32
writeArg(index)
writeEnv(ptr, len)
syscall(ptr, len) -> i32
exit(code)
```

`write`, `writeErr`, `writeEnv`, and `syscall` read bytes from exported module memory. `syscall(ptr, len)` expects a JSON request such as:

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
path_open(dirfd, dirflags, pathPtr, pathLen, oflags, rightsBase, rightsInheriting, fdflags, openedFdPtr) -> errno
fd_prestat_get(fd, resultPtr) -> errno
fd_prestat_dir_name(fd, pathPtr, pathLen) -> errno
proc_exit(code)
random_get(ptr, len) -> errno
clock_time_get(id, precision, resultPtr) -> errno
```

`fd_write` currently writes through the shared DindbOS descriptor table for descriptor `1` stdout and descriptor `2` stderr. `fd_read` reads through the same table, including stdin data supplied by shell pipelines and `runFile({ stdin })`. WASI programs receive a preopened cwd descriptor and can use `path_open` for scoped VFS file read/write. Pipe-backed TTY behavior remains roadmap work.

## Process Model

Each run spawns a process with an app id like `wasm:hello.wasm`. The process receives argv, cwd, a browser-native environment, and a manifest-scoped filesystem policy rooted at the executable directory for first-pass shell runs.

When the module exits, DindbOS records the process lifecycle and removes the running process entry. Crash paths report stderr, return `crashed: true` plus `crashReportPath`, and flow through the runtime process crash path under `/var/log/dindbos/crash-<pid>.log`.

## Current Limits

- no full WASI import surface yet
- no descriptor table, stdin pipes, or TTY device yet
- no worker isolation yet
- no compiler toolchain integration docs yet

## Verification

```bash
npm run smoke:wasm
```

The smoke verifies shell execution, argv/env output, syscall-backed file write, denied syscall EACCES tracing, trap crash report capture, basic WASI `fd_write`/`fd_read`/`path_open`/`fd_close`/`proc_exit`, stdin pipeline delivery, VFS file read/write through opened WASI descriptors, nonzero exit status, and process tracking for `.wasm` files. `npm run smoke:packages` verifies install and AppRegistry launch for a WASM-backed package app.
