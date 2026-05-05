# DindbOS WASM Runtime

DindbOS can run small WebAssembly modules from the VFS as browser-native user processes.

This is an early DindbOS ABI runner, not full WASI yet. Modules run through `WebAssembly.instantiate`, get a process record, and use the `dindbos` import namespace for stdout, argv/env helpers, syscall calls, and exit status.

## Shell Usage

```text
chmod 755 /home/guest/bin/hello.wasm
/home/guest/bin/hello.wasm max
wasm /home/guest/bin/hello.wasm max
```

Executable `.wasm` files can be launched directly through the shell when the execute bit is set. The `wasm` command is the explicit form.

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

## Process Model

Each run spawns a process with an app id like `wasm:hello.wasm`. The process receives argv, cwd, a browser-native environment, and a manifest-scoped filesystem policy rooted at the executable directory for first-pass shell runs.

When the module exits, DindbOS records the process lifecycle and removes the running process entry. Crash paths report stderr and flow through the runtime process crash path.

## Current Limits

- no full WASI import surface yet
- no descriptor table, stdin pipes, or TTY device yet
- no worker isolation yet
- no package manifest WASM entry point yet
- no compiler toolchain integration docs yet

## Verification

```bash
npm run smoke:wasm
```

The smoke verifies shell execution, argv/env output, syscall-backed file write, global syscall tracing, nonzero exit status, and process tracking for `.wasm` files.
