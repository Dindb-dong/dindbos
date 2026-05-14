# DindbOS Shell

DindbOS shell is a small browser-native command environment over the shared VFS. It is not a full POSIX shell.

## Status Codes

Current shell status contract:

- `0`: command completed successfully
- `1`: runtime failure, missing path, missing command, no grep match, missing executable, unsupported package/app state, unsupported privilege escalation
- `2`: usage error or invalid command arguments

Thrown runtime errors become status `1` and are printed as command output.

Usage-like builtin output becomes status `2` for commands such as `npm`, `pkg`, `node`, `kill`, `mount-local`, `umount`, `which`, `man`, `manifest`, `stat`, `find`, and `tree`. Runtime failures for those commands remain status `1`, including missing PIDs, missing paths, missing manual entries, and missing app manifests.

`su` and `sudo` are explicit browser-runtime placeholders. They return status `1` with a fixed-session explanation instead of pretending to elevate privileges.

`grep` returns status `1` when no lines match. `which` returns status `1` when no executable is found.

## Chaining

Command chaining uses status codes:

```text
command-a && command-b
command-a || command-c
command-a ; command-b
```

- `&&` runs the next command only when the previous status is `0`.
- `||` runs the next command only when the previous status is non-zero.
- `;` always runs the next command.

This applies to normal error throws and explicit builtin statuses.

## Pipes And Redirection

Pipes pass stdout-like command output to the next command:

```text
cat note.txt | grep TODO
```

The pipeline status is the status of the last command in the pipeline.

Redirection writes command output into the VFS:

```text
echo hello > note.txt
echo again >> note.txt
grep TODO < note.txt > matches.txt
```

Redirection does not change the command status after the command has already produced matching output. For example, `grep text < in.txt > out.txt` keeps the `grep` match status even though stdout is redirected into a file.

## Script Dialect

Executable scripts are DindbOS shell scripts, not POSIX shell scripts.

Supported shebangs:

```text
#!dindbsh
#!/bin/dindbsh
#!/usr/bin/dindbsh
#!/usr/bin/env dindbsh
```

Scripts support:

- comments beginning with `#`
- command chaining
- pipes and redirection
- `$0`, `$1`, `$@`, and `$#`
- execution through direct path or `PATH`
- execute-bit enforcement

Current limits:

- no subshells
- no glob expansion
- no POSIX function syntax
- no here-docs
- no job control
- no full stderr/stdout split

## Package Trust

Remote package trust is managed by the package command:

```text
pkg trust list
pkg trust add <publisher-id> <ed25519-public-key> [name]
pkg trust remove <publisher-id|ed25519-public-key>
```

Unsigned, invalid, or untrusted remote manifests fail before package files or launchers are written unless a runtime caller explicitly allows unsigned or untrusted installs.

## WebAssembly

Executable `.wasm` files run through the DindbOS WASM runtime:

```text
chmod 755 /home/guest/bin/hello.wasm
/home/guest/bin/hello.wasm max
wasm /home/guest/bin/hello.wasm max
```

The first-pass WASM runtime provides argv/env helpers, stdout/stderr helpers, syscall access, exit status handling, and process tracking. See `docs/wasm.md`.

## Troubleshooting

`doctor` prints a compact runtime diagnostic snapshot for support and bug reports:

```text
doctor
doctor compat
doctor isolation
```

It reports the active session, current working directory, storage backend and dirty-write state, local mount availability/counts, file helper rename support, installed package count, running process count, and the follow-up commands that expose deeper runtime details. `mount-local --helper` prints the native file helper protocol status for local mount operations that cannot be implemented honestly inside the browser sandbox.

`doctor compat` prints the DindbOS compatibility tiers, browser capability probes, storage backend, browser provider companion endpoint, and hard unsupported native boundaries. Use it before installing a package that declares a required compatibility tier.

`doctor isolation` prints the active cross-origin isolation profile, required COOP/COEP/CORP headers, SharedArrayBuffer/Atomics availability, degraded-mode reasons, and worker memory-region transfer mode. See `docs/isolation.md`.

`recovery status`, `recovery profiles`, `recovery profile [profile]`, `recovery queue`, and `recovery panic` expose Service Worker boot state, active safe boot enforcement, the explicit offline maintenance queue, and recovery shell/panic diagnostics. See `docs/service-worker-recovery.md`.

`conformance`, `conformance matrix`, `conformance json`, and `doctor conformance` print the generated compatibility certification report. See `docs/conformance.md`.

`bootctl status`, `bootctl measurements`, and `bootctl verify` print secure boot measurements for base files, package records, app registry manifests, trusted publishers, and executable package policy proofs.

`policyctl prove [package]` runs compiled package denial proof descriptors as negative tests and mirrors the result under `/proc/policy/proofs`.

`syscall <name> [json]` calls the DindbOS syscall ABI and prints the structured JSON result. See `docs/syscalls.md` for the supported syscall names, errno-style failures, and trace files under `/var/log/dindbos/syscall.log` and `/proc/<pid>/syscalls`.

`sync status`, `sync conflicts`, and `sync resolve <use-conflict|keep-local|delete-conflict> <conflict-path>` expose the remote sync repair boundary. Conflict copies live under `.sync-conflicts`; resolving with `use-conflict` applies the preserved remote bytes to the target file, while `keep-local` or `delete-conflict` removes the conflict copy without replacing the local file.

## Verification

```bash
npm run smoke:shell
```

The shell smoke verifies parser behavior, quoted separators, escaped quotes, empty string arguments, mixed pipes/redirection, chaining, status-code-driven `&&`/`||`, command suggestions, doctor diagnostics, compatibility diagnostics, raw syscall ABI calls, package trust commands, executable scripts, stdin pipelines, execute-bit enforcement, and unsupported shebang failures. `npm run smoke:wasm` verifies executable `.wasm` shell integration.
