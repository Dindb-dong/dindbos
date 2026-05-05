# DindbOS Syscall ABI

DindbOS exposes a browser-native syscall ABI through `os.syscall(name, args)` and `os.syscallAsync(name, args)` for async runtime barriers.

This is not a Linux syscall table. It is the stable low-level boundary for DindbOS programs that need to target runtime services without importing private kernel objects. Higher-level JavaScript app APIs can continue to exist, but new low-level runtimes such as WASM, workers, and package CLIs should be able to use the same syscall boundary.

## Result Shape

Every syscall returns a structured result:

```json
{
  "ok": true,
  "value": {}
}
```

Failures do not expose raw stack traces:

```json
{
  "ok": false,
  "error": {
    "code": "ENOENT",
    "message": "syscall: fs.stat: /missing: no such file or directory",
    "syscall": "fs.stat"
  }
}
```

Current errno-style codes include:

- `OK`: trace-only success code.
- `EINVAL`: missing or invalid arguments.
- `ENOSYS`: syscall name is not implemented.
- `ENOENT`: missing file, path, or runtime object.
- `ESRCH`: missing process.
- `EACCES`: filesystem, capability, or sandbox denial.
- `EBADF`: invalid or closed file descriptor.
- `ENODEV`: missing pseudo-device.
- `ENOTTY`: descriptor does not support terminal/device control operations.
- `ESPIPE`: descriptor is not seekable.
- `EIO`: unexpected runtime failure.

## Current Syscalls

```text
clock.now
entropy.randomBytes
fs.exists
fs.stat
fs.readText
fs.writeText
fd.list
fd.open
fd.read
fd.write
fd.seek
fd.stat
fd.sync
fd.ioctl
fd.close
env.get
env.list
app.list
app.manifest
package.list
package.info
storage.status
storage.sync
localMount.status
mount.list
mount.mount
mount.unmount
process.list
process.get
process.log
app.launch
```

Filesystem and descriptor syscalls run through the caller's VFS principal and, for sandboxed apps, the app manifest filesystem scopes. Process, package, storage, local mount, mount, and app launch syscalls run through the same capability checks used by the existing high-level app facade.

`storage.sync` is the first durability-barrier syscall. It requires `storage.read`, waits for the runtime persistence flush path, and returns storage plus persistence status. It is intentionally not the same as the administrative `storage flush` settings operation: ordinary programs may request a best-effort durability barrier for their own completed writes, while destructive storage management still requires `storage.manage` and administrator approval.

`mount.list` returns the shared DindbOS mount table. `mount.mount` and `mount.unmount` currently manage runtime `memfs` mounts, readonly `overlayfs` snapshot mounts, and readonly `zipfs` mounts for stored-method ZIP archives. Overlay mounts require `lower` and `upper` paths and use upper-over-lower precedence; ZIP mounts require an `archive` path. Unsupported drivers or ZIP compression methods fail with `ENOTSUP` instead of pretending the browser can mount arbitrary host filesystems. Sandboxed apps need `mount.read` or `mount.manage` capabilities for these calls.

Descriptor syscalls require a process context. New processes receive standard descriptors `0` stdin, `1` stdout, and `2` stderr. `fd.open` currently supports text VFS files plus `/dev/null`, `/dev/zero`, `/dev/random`, `/dev/urandom`, `/dev/tty`, and `/dev/clipboard`; descriptor state is exposed under `/proc/<pid>/fd.json` and cleaned up when the process exits or crashes.

`fd.sync` is an async descriptor durability barrier for file descriptors. It validates that the descriptor is a file descriptor and then waits for the same runtime persistence flush path as `storage.sync`. Devices, pipes, terminals, and standard streams reject `fd.sync` instead of pretending they are disk-backed files.

`fd.ioctl` is the structured control boundary for descriptors that need device-style operations. The first supported requests are `tty.getWindowSize`, `tty.setWindowSize`, and `tty.isatty` for `/dev/tty` plus standard stream descriptors. Non-TTY descriptors return `ENOTTY`.

Entropy and zero devices report `fd.read.bytes` as the actual device byte count returned by the pseudo-device, not the UTF-8 byte length of the JSON string representation.

`/dev/clipboard` maps to the DindbOS runtime clipboard service. It is a browser-native OS clipboard primitive inside the DindbOS session, not a promise that every descriptor write can synchronously mutate the host browser clipboard; host clipboard bridging remains subject to browser permission and user-gesture policy.

Terminal.app creates a DindbOS pseudo-terminal session. Processes launched with that PTY session receive TTY metadata on standard streams and `/dev/tty`; reads can consume the PTY input buffer, writes append to the PTY output buffer, and `tty.getWindowSize`/`tty.setWindowSize` operate on the shared session size.

Pipe descriptors are backed by runtime pipe objects that can be attached to more than one process descriptor table. This lets a writer process, intermediate process, and reader process exchange bytes through the same descriptor-backed pipe primitive instead of shell-only string plumbing.

## Shell Usage

Terminal can call the ABI directly:

```text
syscall fs.writeText '{"path":"note.txt","content":"hello"}'
syscall fs.readText '{"path":"note.txt"}'
syscall package.info '{"packageId":"hello-notes"}'
syscall storage.status
syscall storage.sync
syscall process.list
```

The command prints the raw structured JSON result and exits nonzero when `ok` is false.

## Tracing

Syscall traces are written to:

- `/var/log/dindbos/syscall.log`
- `/proc/<pid>/syscalls` when the caller has a process id

Trace arguments are summarized and secret/token-looking fields are redacted. Traces are for debugging ABI usage, not for persisting sensitive app data.

## Compatibility Boundary

The syscall ABI is the target boundary for future WASM and worker-backed user processes. Unsupported native behavior must fail with `ENOSYS` or a specific policy error instead of pretending the browser can provide kernel mode, hardware drivers, arbitrary host filesystem access, native binaries, or unrestricted raw sockets.

The first WASM runner already calls this ABI through the `dindbos.syscall(ptr, len)` import. Async barriers can be started through `dindbos.syscallAsync(ptr, len)`; the runner waits for those pending async syscalls before reporting process completion. Full WASI mapping remains a separate compatibility layer.
