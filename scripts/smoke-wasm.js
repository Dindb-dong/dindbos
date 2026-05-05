#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";
import { ShellSession } from "../src/dindbos/shell.js";

const os = new DindbOS({ root: {}, storage: memoryStorage() });
const system = os.permissions.systemPrincipal();
os.ensureDirectoryPath("/home/guest/bin", { leafOwner: "guest", leafGroup: "users", principal: system });

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
os.fs.writeOrCreateFileBytes("/home/guest/bin/trap.wasm", trapWasm(), "/", {
  owner: "guest",
  group: "users",
  permissions: "-rwxr-xr-x",
  mime: "application/wasm",
}, system);

const shell = new ShellSession(os);
let result = await shell.executeAsync("export PATH=$PATH:/home/guest/bin && hello.wasm max");
assert(result.status === 0, `shell wasm status mismatch: ${result.status} ${result.output}`);
assert(result.output === "hello max\nuser=guest\n", `shell wasm output mismatch: ${JSON.stringify(result.output)}`);
assert(os.processes.history.some((process) => process.appId === "wasm:hello.wasm"), "wasm shell run was not tracked as a process");

const syscallRun = await os.wasm.runFile("/home/guest/bin/syscall.wasm", "/home/guest/bin", {
  principal: os.permissions.principal(os.session),
});
assert(syscallRun.status === 0, `wasm syscall run status mismatch: ${syscallRun.status} ${syscallRun.stderr}`);
assert(os.fs.readFile("/home/guest/bin/wasm-syscall.txt") === "from wasm syscall", "wasm syscall did not write through DindbOS syscall ABI");
assert(os.fs.readFile("/var/log/dindbos/syscall.log").includes("fs.writeText OK"), "wasm syscall did not write global syscall trace");

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

const trapRun = await os.wasm.runFile("/home/guest/bin/trap.wasm", "/home/guest/bin", {
  principal: os.permissions.principal(os.session),
});
assert(trapRun.status === 1, `wasm trap status mismatch: ${trapRun.status}`);
assert(trapRun.crashed === true, "wasm trap did not report crashed=true");
assert(trapRun.crashReportPath === `/var/log/dindbos/crash-${trapRun.pid}.log`, `wasm trap crash path mismatch: ${trapRun.crashReportPath}`);
assert(os.fs.exists(trapRun.crashReportPath), "wasm trap crash report was not written");
assert(os.fs.readFile(trapRun.crashReportPath).includes("unreachable"), "wasm trap crash report missing trap message");
assert(os.fs.readFile("/var/log/dindbos/crashes.log").includes(`pid=${trapRun.pid} app=wasm:trap.wasm`), "wasm trap crash index missing pid/app");

console.log("wasm smoke ok shell argv env syscall exit permission crash process");

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

function wasmModule({ types, imports, startType, body, data }) {
  const importCount = imports.length;
  const sections = [
    section(1, [types.length, ...types.flatMap(typeBytes)]),
    section(2, [imports.length, ...imports.flatMap((entry) => [...stringBytes("dindbos"), ...stringBytes(entry.name), 0x00, ...u32(entry.type)])]),
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

function memoryStorage() {
  return {
    async loadFileSystem() {
      return null;
    },
    saveFileSystem() {},
    async flush() {},
    status: () => ({ backend: "memory", bytes: 0 }),
    estimate: async () => ({ backend: "memory", bytes: 0 }),
    resetFileSystem() {},
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
