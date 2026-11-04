import assert from "node:assert/strict";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";
import { createDindbOSTestRuntime } from "./helpers/dindbos-test-runtime.js";

const nfd = (value) => value.normalize("NFD");
const folder = "/한글", file = `${folder}/café.txt`;
const content = "한글 e\u0301";
const fs = new VirtualFileSystem();
fs.createDirectory(nfd(folder));
fs.writeOrCreateFile(nfd(file), content);
assert.equal(fs.readFile(file), content, "only names, never text content, are normalized");
assert.equal(fs.list(nfd(folder))[0].name, "café.txt");
assert.equal(fs.lstat(nfd(file)).path, file);
fs.copy(nfd(file), nfd(`${folder}/복사.txt`));
fs.move(nfd(`${folder}/복사.txt`), nfd(`${folder}/이동.txt`));
fs.atomicWriteOrCreateFile(nfd(`${folder}/이동.txt`), content);
assert.equal(fs.readFile(`${folder}/이동.txt`), content);
fs.createSymlink(nfd("café.txt"), nfd(`${folder}/링크`));
assert.equal(fs.readFile(`${folder}/링크`), content);
assert.equal(fs.readlink(nfd(`${folder}/링크`)), "café.txt");
const bytes = new Uint8Array([0, 128, 255]);
fs.writeOrCreateFileBytes(nfd(`${folder}/바이너리.bin`), bytes);
fs.createHardLink(nfd(file), nfd(`${folder}/하드링크`));
assert.equal(fs.readFile(`${folder}/하드링크`), content);
assert.equal(fs.normalize("café.txt", nfd(folder)), file);
assert.equal(new VirtualFileSystem(null, {home:nfd(folder)}).normalize("~/café.txt"), file);
const reloaded = new VirtualFileSystem(fs.snapshot());
assert.equal(reloaded.readFile(nfd(file)), content);
assert.deepEqual(reloaded.readFileBytes(`${folder}/바이너리.bin`), bytes);
fs.remove(nfd(`${folder}/이동.txt`));
assert.equal(fs.exists(`${folder}/이동.txt`), false);
const legacy = new VirtualFileSystem({name:"",type:"directory",children:[{name:nfd("한글"),type:"directory",children:[{name:nfd("café.txt"),type:"file",content}]}]});
assert.equal(legacy.readFile(file), content);
assert.equal(legacy.snapshot().children[0].name, "한글");
assert.equal(legacy.snapshot().children[0].children[0].name, "café.txt");

const collisionTree = {name:"",type:"directory",children:[{name:"café",type:"file",content:"first"},{name:nfd("café"),type:"file",content:"second"},{name:"safe",type:"file",content:"safe"}]};
const collisions = new VirtualFileSystem(collisionTree);
const original = collisions.snapshot();
for (const name of ["/café", nfd("/café")]) {
  for (const action of [() => collisions.readFile(name), () => collisions.writeOrCreateFile(name,"lost"), () => collisions.atomicWriteOrCreateFile(name,"lost"), () => collisions.remove(name), () => collisions.move(name,"/renamed"), () => collisions.copy("/safe",name), () => collisions.lstat(name)]) assert.throws(action, /Ambiguous NFC filename/);
}
assert.equal(collisions.readFile("/safe"), "safe");
assert(collisions.checkIntegrity().problems.some((entry) => entry.code === "duplicate-name"));
assert.deepEqual(collisions.snapshot(), original, "collision checks preserve both original names and bytes");
assert.throws(() => new VirtualFileSystem(collisions.snapshot()).readFile("/café"), /Ambiguous NFC filename/);

const os = createDindbOSTestRuntime();
const allowed = "/home/guest/허용", outside = "/home/guest/외부";
os.fs.createDirectory(nfd(allowed),"/",{owner:"guest",group:"users"});
os.fs.createDirectory(nfd(outside),"/",{owner:"guest",group:"users"});
os.fs.writeOrCreateFile(nfd(`${allowed}/café.txt`),content,"/",{owner:"guest",group:"users"});
os.fs.writeOrCreateFile(nfd(`${outside}/비밀.txt`),"secret");
os.fs.createSymlink(nfd(`${outside}/비밀.txt`),nfd(`${allowed}/탈출`));
os.fs.writeOrCreateFile(`${allowed}/보호.txt`, "private", "/", {owner:"root",group:"root",permissions:"-rw-------"});
const process = os.processes.spawn({id:"nfc-probe",manifest:{capabilities:[],fileSystem:{read:[nfd(allowed)],write:[nfd(allowed)]}}},{cwd:allowed});
const sandbox = os.createSandbox(process);
assert.equal(sandbox.fs.readFile(`${allowed}/café.txt`),content);
assert.equal(sandbox.fs.readFile(nfd(`${allowed}/café.txt`)),content);
sandbox.fs.writeFile(nfd(`${allowed}/café.txt`),content);
for (const path of [`${allowed}/보호.txt`, nfd(`${allowed}/보호.txt`)]) {
  assert.throws(() => sandbox.fs.readFile(path), /permission denied/);
  assert.throws(() => sandbox.fs.writeFile(path, "lost"), /permission denied/);
}
for (const path of [`${outside}/비밀.txt`,`${allowed}/탈출`]) for (const spelling of [path,nfd(path)]) {
  assert.throws(() => sandbox.fs.readFile(spelling),/sandbox denied/);
  assert.throws(() => sandbox.fs.writeFile(spelling,"lost"),/sandbox denied/);
}
assert.equal(os.fs.readFile(`${outside}/비밀.txt`),"secret");
console.log("NFC paths smoke passed: CRUD, atomic writes, links, bytes, legacy reload, preserved collisions and sandbox grants/escapes");
