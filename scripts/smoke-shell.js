#!/usr/bin/env node
import { ShellSession } from "../src/dindbos/shell.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const shell = new ShellSession(bootOs());

let result = await shell.executeAsync('echo "alpha|beta" | grep "|"');
assert(result.status === 0, `quoted pipe pipeline status mismatch: ${result.status}`);
assert(result.output === "alpha|beta", `quoted pipe output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync('echo "left;right"; echo done');
assert(result.status === 0, `quoted semicolon command status mismatch: ${result.status}`);
assert(result.output === "left;right\ndone", `quoted semicolon output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("echo \"say \\\"hello\\\"\" | grep \"hello\"");
assert(result.status === 0, `escaped quote pipeline status mismatch: ${result.status}`);
assert(result.output === 'say "hello"', `escaped quote pipeline output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("echo '' \"\" tail");
assert(result.status === 0, `empty string token status mismatch: ${result.status}`);
assert(result.output === "  tail", `empty string token output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("echo persisted > note.txt && cat note.txt");
assert(result.status === 0, `redirection chain status mismatch: ${result.status}`);
assert(result.output === "persisted\n", `redirection chain output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("echo alpha>compact.txt && grep alpha < compact.txt | grep alpha > filtered.txt && cat filtered.txt");
assert(result.status === 0, `mixed redirection pipeline status mismatch: ${result.status}`);
assert(result.output === "alpha\n", `mixed redirection pipeline output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("missing-command && echo should-not-run || echo fallback");
assert(result.status === 0, `fallback chain final status mismatch: ${result.status}`);
assert(result.output === "command not found: missing-command\nfallback", `fallback chain output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("missing-command || echo recovered && echo final");
assert(result.status === 0, `recovery chain final status mismatch: ${result.status}`);
assert(result.output === "command not found: missing-command\nrecovered\nfinal", `recovery chain output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("cat missing.txt");
assert(result.status === 1, `missing file status mismatch: ${result.status}`);
assert(result.output.includes("File not found"), `missing file output mismatch: ${result.output}`);

result = await shell.executeAsync("echo alpha | grep beta && echo should-not-run || echo no-match");
assert(result.status === 0, `grep no-match chain status mismatch: ${result.status}`);
assert(result.output === "no-match", `grep no-match chain output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("which not-installed && echo should-not-run || echo missing-path");
assert(result.status === 0, `which missing chain status mismatch: ${result.status}`);
assert(result.output === "missing-path", `which missing chain output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("npm && echo should-not-run || echo usage-status");
assert(result.status === 0, `usage chain final status mismatch: ${result.status}`);
assert(result.output === "npm: usage: npm install <package...>\nusage-status", `usage chain output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("npm");
assert(result.status === 2, `usage status code mismatch: ${result.status}`);
assert(result.output === "npm: usage: npm install <package...>", `usage output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("kill");
assert(result.status === 2, `kill usage status mismatch: ${result.status}`);
assert(result.output === "kill: usage: kill <pid>", `kill usage output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("kill 999");
assert(result.status === 1, `kill missing pid status mismatch: ${result.status}`);
assert(result.output.includes("no such process"), `kill missing pid output mismatch: ${result.output}`);

result = await shell.executeAsync("stat /missing");
assert(result.status === 1, `stat missing path status mismatch: ${result.status}`);
assert(result.output === "stat: no such file or directory", `stat missing path output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("find /missing needle");
assert(result.status === 1, `find missing path status mismatch: ${result.status}`);
assert(result.output.includes("no such file or directory"), `find missing path output mismatch: ${result.output}`);

result = await shell.executeAsync("man no-such-command");
assert(result.status === 1, `man missing entry status mismatch: ${result.status}`);
assert(result.output.includes("no manual entry"), `man missing entry output mismatch: ${result.output}`);

result = await shell.executeAsync("manifest missing-app");
assert(result.status === 1, `manifest missing app status mismatch: ${result.status}`);
assert(result.output.includes("no such app"), `manifest missing app output mismatch: ${result.output}`);

result = await shell.executeAsync("sudo echo elevated && echo should-not-run || echo no-escalation");
assert(result.status === 0, `sudo unsupported chain status mismatch: ${result.status}`);
assert(
  result.output === "sudo: unsupported in DindbOS browser runtime; session user is fixed to guest\nno-escalation",
  `sudo unsupported chain output mismatch: ${JSON.stringify(result.output)}`,
);

result = await shell.executeAsync("su root");
assert(result.status === 1, `su unsupported status mismatch: ${result.status}`);
assert(result.output === "su: unsupported in DindbOS browser runtime; session user is fixed to guest", `su unsupported output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync('echo "cat: no such text is still file content" > literal.txt && cat literal.txt');
assert(result.status === 0, `literal content status mismatch: ${result.status}`);
assert(result.output === "cat: no such text is still file content\n", `literal content output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("opne");
assert(result.status === 1, `unknown builtin typo status mismatch: ${result.status}`);
assert(result.output.includes("Did you mean: open"), `builtin suggestion mismatch: ${result.output}`);

result = await shell.executeAsync("calculatr");
assert(result.status === 1, `unknown app typo status mismatch: ${result.status}`);
assert(result.output.includes("open Calculator"), `app suggestion mismatch: ${result.output}`);

result = await shell.executeAsync("hello-note");
assert(result.status === 1, `unknown package typo status mismatch: ${result.status}`);
assert(result.output.includes("pkg info hello-notes"), `package suggestion mismatch: ${result.output}`);

const system = shell.os.permissions.systemPrincipal();
shell.os.fs.createDirectory("/home/guest/bin", "/", { owner: "guest", group: "users" }, system);
shell.os.fs.writeOrCreateFile(
  "/home/guest/bin/hello",
  "#!/bin/dindbsh\n# comment lines are skipped\necho hello $1\necho args:$@\n",
  "/",
  { owner: "guest", group: "users", permissions: "-rw-r--r--" },
  system,
);
shell.os.fs.writeOrCreateFile(
  "/home/guest/bin/pick",
  "#!/usr/bin/env dindbsh\ngrep $1\n",
  "/",
  { owner: "guest", group: "users", permissions: "-rw-r--r--" },
  system,
);
shell.os.fs.writeOrCreateFile(
  "/home/guest/bin/locked",
  "#!/bin/dindbsh\necho should-not-run\n",
  "/",
  { owner: "guest", group: "users", permissions: "-rw-r--r--" },
  system,
);
shell.os.fs.writeOrCreateFile(
  "/home/guest/bin/pythonish",
  "#!/usr/bin/python3\necho should-not-run\n",
  "/",
  { owner: "guest", group: "users", permissions: "-rwxr-xr-x" },
  system,
);

result = await shell.executeAsync("export PATH=$PATH:/home/guest/bin && chmod 755 /home/guest/bin/hello && which hello && hello max kim");
assert(result.status === 0, `script path execution status mismatch: ${result.status}`);
assert(
  result.output === "/home/guest/bin/hello\nhello max\nargs:max kim",
  `script path execution output mismatch: ${JSON.stringify(result.output)}`,
);

result = await shell.executeAsync("chmod 755 /home/guest/bin/pick && echo alpha beta | pick beta");
assert(result.status === 0, `script stdin pipeline status mismatch: ${result.status}`);
assert(result.output === "alpha beta", `script stdin pipeline output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("/home/guest/bin/locked");
assert(result.status === 1, `non-executable script status mismatch: ${result.status}`);
assert(result.output.includes("permission denied"), `non-executable script output mismatch: ${result.output}`);

result = await shell.executeAsync("/home/guest/bin/pythonish");
assert(result.status === 1, `unsupported shebang status mismatch: ${result.status}`);
assert(result.output.includes("unsupported interpreter"), `unsupported shebang output mismatch: ${result.output}`);

console.log("shell smoke ok parser chaining status scripts");

function bootOs() {
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
  const system = permissions.systemPrincipal();
  fs.createDirectory("/home", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/home/guest", "/", { owner: "guest", group: "users" }, system);
  return {
    fs,
    permissions,
    session: { user: "guest", groups: ["users"], home: "/home/guest" },
    localMounts: {
      isMountedPath: () => false,
    },
    storage: {
      status: () => ({ backend: "memory", bytes: 0 }),
      estimate: async () => ({ backend: "memory", bytes: 0 }),
    },
    apps: {
      list: () => [{ id: "calculator", name: "Calculator" }],
      manifests: () => [],
      getManifest: () => null,
    },
    packages: {
      list: () => [{ id: "hello-notes", name: "Hello Notes" }],
    },
    processes: {
      table: () => "",
      kill: (pid) => {
        throw new Error(`kill: ${pid}: no such process`);
      },
    },
    openPath: () => null,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
