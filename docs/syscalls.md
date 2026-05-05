# DindbOS Syscall ABI

DindbOS exposes a browser-native syscall ABI through `os.syscall(name, args)`.

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
- `EIO`: unexpected runtime failure.

## Current Syscalls

```text
clock.now
entropy.randomBytes
fs.exists
fs.stat
fs.readText
fs.writeText
process.list
process.get
process.log
app.launch
```

Filesystem syscalls run through the caller's VFS principal and, for sandboxed apps, the app manifest filesystem scopes. Process and app syscalls run through the same capability checks used by the existing high-level app facade.

## Shell Usage

Terminal can call the ABI directly:

```text
syscall fs.writeText '{"path":"note.txt","content":"hello"}'
syscall fs.readText '{"path":"note.txt"}'
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
