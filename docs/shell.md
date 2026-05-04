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

## Verification

```bash
npm run smoke:shell
```

The shell smoke verifies parser behavior, quoted separators, escaped quotes, empty string arguments, mixed pipes/redirection, chaining, status-code-driven `&&`/`||`, command suggestions, executable scripts, stdin pipelines, execute-bit enforcement, and unsupported shebang failures.
