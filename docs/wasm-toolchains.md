# DindbOS WASM Toolchain Notes

DindbOS can run small WASI-style WebAssembly CLIs and DindbOS ABI modules from the VFS. This page documents the supported target shape for C, Rust, Zig, and TinyGo examples.

The runtime target is intentionally narrow:

- export `memory`
- export `_start` or `main`
- use `wasi_snapshot_preview1` for CLI IO, argv/env, file descriptors, scoped path operations, random, and clock calls listed in [wasm.md](./wasm.md)
- optionally import `dindbos.checkDeadline()` for cooperative timeout, abort, and grow-time memory checks
- optionally import `dindbos.syscallAsync(ptr, len)` or use WASI `fd_sync` / `fd_datasync` when a browser-backed durability barrier must complete before the WASM process reports success
- avoid unsupported host APIs such as sockets, native threads, subprocesses, mmap-style OS calls, and unrestricted filesystem paths

## C With WASI SDK

```c
#include <stdio.h>

int main(int argc, char **argv) {
  const char *name = argc > 1 ? argv[1] : "guest";
  printf("hello %s\n", name);
  return 0;
}
```

Build with a WASI-capable Clang from a local WASI SDK:

```bash
$WASI_SDK_PATH/bin/clang --target=wasm32-wasi -O2 -o hello.wasm hello.c
```

After importing, mounting, or packaging the build artifact into the DindbOS VFS, run:

```text
cp hello.wasm /home/guest/bin/hello.wasm
chmod 755 /home/guest/bin/hello.wasm
/home/guest/bin/hello.wasm max
```

## Rust

```rust
fn main() {
    let name = std::env::args().nth(1).unwrap_or_else(|| "guest".to_string());
    println!("hello {name}");
}
```

Build for a WASI preview 1 target:

```bash
rustup target add wasm32-wasip1
cargo build --target wasm32-wasip1 --release
```

Use the generated `.wasm` from `target/wasm32-wasip1/release/`. If a local Rust installation still uses the older `wasm32-wasi` target name, use that target only when it produces WASI preview 1 imports compatible with DindbOS.

## Zig

```zig
const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("hello zig\n", .{});
}
```

Build:

```bash
zig build-exe hello.zig -target wasm32-wasi -O ReleaseSmall -femit-bin=hello.wasm
```

Keep Zig examples limited to stdout/stderr, argv/env, stdin, and scoped VFS file operations until DindbOS broadens the WASI import surface.

## TinyGo

```go
package main

func main() {
	println("hello tinygo")
}
```

Build:

```bash
tinygo build -target=wasi -o hello.wasm main.go
```

TinyGo packages that import networking, host process, or threading APIs are outside the current DindbOS compatibility tier.

## Scoped Files

WASI file access is scoped by the spawned process manifest. Direct `runFile` callers can broaden scopes explicitly:

```js
await os.wasm.runFile("/home/guest/bin/tool.wasm", "/home/guest/bin", {
  fileSystem: {
    read: ["/home/guest/bin", "/home/guest/data"],
    write: ["/home/guest/data"],
  },
  principal: os.permissions.principal(os.session),
});
```

Package apps should declare the same policy in `dindbos.app.json`:

```json
{
  "id": "dev.example.wasm-tool",
  "name": "WASM Tool",
  "version": "0.1.0",
  "runtime": "wasm",
  "entry": "bin/tool.wasm",
  "capabilities": ["process.read"],
  "fileSystem": {
    "read": ["/home/guest/data"],
    "write": ["/home/guest/data"]
  }
}
```

## Cooperative Limits

Native OSes can preempt processes. Browser WebAssembly cannot be interrupted from the main thread without moving execution into a worker or adding cooperative checks. DindbOS therefore supports a DindbOS ABI import for modules that can call back periodically:

```c
__attribute__((import_module("dindbos"), import_name("checkDeadline")))
extern int dindbos_check_deadline(void);
```

Call it inside long loops and after large allocations. If `timeoutMs`, `abortSignal`, or `maxMemoryPages` has been violated, DindbOS routes the failure through the normal process crash path.

## Durability Barriers

WASM imports are synchronous, so DindbOS does not pretend a module can block the JavaScript event loop until browser storage finishes. Instead, `dindbos.syscallAsync(ptr, len)` starts an async syscall such as `storage.sync`, and WASI `fd_sync` / `fd_datasync` start descriptor-backed sync work. `WasmRunner` waits for those pending barriers before it reports the process exit status.

## Compatibility Checklist

- Prefer WASI preview 1 CLI output and descriptor APIs.
- Keep stdout/stderr text output UTF-8.
- Use relative paths under the preopened cwd or explicit scoped directories.
- Keep modules small and deterministic; long loops should call `dindbos.checkDeadline()`.
- Use `npm run smoke:wasm` after changing the runtime ABI or supported WASI surface.
