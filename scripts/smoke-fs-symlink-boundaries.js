#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createDindbOSTestRuntime } from './helpers/dindbos-test-runtime.js';

const os = createDindbOSTestRuntime();
const root = '/home/guest';
for (const path of [`${root}/allowed`, `${root}/outside`, `${root}/allowed/destination`]) os.fs.createDirectory(path, '/', {owner:'guest',group:'users'});
const allowed = `${root}/allowed`, outside = `${root}/outside`;
os.fs.createFile(`${outside}/secret.txt`, '/', {content:'private bytes',owner:'guest',group:'users'});
os.fs.createFile(`${allowed}/own.txt`, '/', {content:'own bytes',owner:'guest',group:'users'});
os.fs.createSymlink(`${outside}/secret.txt`, `${allowed}/escape.txt`);
os.fs.createSymlink(outside, `${allowed}/escape-dir`);
os.fs.createSymlink('own.txt', `${allowed}/inside.txt`);
const app = {id:'boundary-probe',manifest:{capabilities:['app.launch','node.execute'],fileSystem:{read:[allowed],write:[allowed]}}};
const sandbox = os.createSandbox(os.processes.spawn(app, {cwd:allowed}));
const denied = fn => assert.throws(fn, /sandbox denied/);
for (const path of [`${allowed}/escape.txt`, `${allowed}/escape-dir/secret.txt`]) {
  for (const method of ['readFile','readFileBytes','resolve','stat','exists']) denied(() => sandbox.fs[method](path));
  denied(() => sandbox.fs.writeFile(path,'overwritten'));
  denied(() => sandbox.fs.chmod(path,'777'));
  denied(() => sandbox.openPath(path));
  denied(() => sandbox.fs.copy(path,`${allowed}/copied.txt`));
}
denied(() => sandbox.fs.list(`${allowed}/escape-dir`));
denied(() => sandbox.fs.createFile(`${allowed}/escape-dir/new.txt`, '/', {content:'escape'}));
denied(() => sandbox.fs.createDirectory(`${allowed}/escape-dir/new-dir`));
denied(() => sandbox.fs.move(`${allowed}/own.txt`,`${allowed}/escape-dir/moved.txt`));
denied(() => sandbox.fs.copy(`${allowed}/own.txt`,`${allowed}/escape-dir/copied.txt`));
// A caller-supplied target/content must never be trusted over the authorized path.
assert.equal(sandbox.fs.resolveNode({type:'link',path:`${allowed}/own.txt`,target:`${outside}/secret.txt`}).content,'own bytes');
assert.equal(sandbox.fs.readFile(`${allowed}/inside.txt`),'own bytes');
sandbox.fs.writeFile(`${allowed}/inside.txt`,'inside changed');
assert.equal(os.fs.readFile(`${allowed}/own.txt`),'inside changed');
const read = sandbox.syscall('fs.readText',{path:`${allowed}/escape.txt`});
assert.equal(read.ok,false);assert.match(read.error.message,/sandbox denied/);
const write = sandbox.syscall('fs.writeText',{path:`${allowed}/escape-dir/new.txt`,content:'escape'});
assert.equal(write.ok,false);assert.match(write.error.message,/sandbox denied/);
denied(() => sandbox.node.evaluate("require('fs').readFileSync('escape.txt','utf8')",allowed));
denied(() => sandbox.node.evaluate("require('fs').writeFileSync('escape-dir/node.txt','escape')",allowed));
// Entry operations can inspect, rename, and remove the symlink without touching its target.
assert.equal(sandbox.fs.lstat(`${allowed}/escape.txt`).type,'link');
sandbox.fs.move(`${allowed}/escape.txt`, `${allowed}/renamed-link.txt`);
sandbox.fs.remove(`${allowed}/renamed-link.txt`);
assert.equal(os.fs.readFile(`${outside}/secret.txt`),'private bytes');
assert.equal(os.fs.exists(`${outside}/new.txt`),false);
assert.equal(os.fs.exists(`${outside}/node.txt`),false);
// An already-open descriptor must recheck a symlink after another app changes it.
os.fs.createSymlink(`${allowed}/own.txt`, `${allowed}/descriptor-link.txt`);
const opened = sandbox.syscall('fd.open', {path:`${allowed}/descriptor-link.txt`,flags:'r'});
assert.equal(opened.ok,true);
os.fs.remove(`${allowed}/descriptor-link.txt`);
os.fs.createSymlink(`${outside}/secret.txt`,`${allowed}/descriptor-link.txt`);
const descriptorRead = sandbox.syscall('fd.read',{fd:opened.value.fd,length:100});
assert.equal(descriptorRead.ok,false);assert.match(descriptorRead.error.message,/sandbox denied/);
const descriptorSeek = sandbox.syscall('fd.seek',{fd:opened.value.fd,offset:0,whence:'end'});
assert.equal(descriptorSeek.ok,false);assert.match(descriptorSeek.error.message,/sandbox denied/);
// A host-created hard link must not fan writes out to a name outside the write grant.
os.fs.createHardLink(`${outside}/secret.txt`, `${allowed}/hard-link.txt`);
denied(() => sandbox.fs.writeFile(`${allowed}/hard-link.txt`,'hard-link escape'));
assert.equal(os.fs.readFile(`${outside}/secret.txt`),'private bytes');
// Awaiting a Blob-like payload cannot authorize an old symlink target and write a new one.
let release;
const blob = {size:4,type:'text/plain',arrayBuffer:()=>new Promise(resolve=>{release=resolve;})};
const pending = sandbox.fs.writeOrCreateFileBlob(`${allowed}/racing/new.txt`,blob);
os.fs.createSymlink(outside,`${allowed}/racing`);
release(new TextEncoder().encode('race').buffer);
await assert.rejects(pending,/sandbox denied/);
assert.equal(os.fs.exists(`${outside}/new.txt`),false);
console.log('filesystem sandbox boundaries smoke passed: symlink read/write/ancestor/missing targets, entry operations, forged nodes, syscalls, NodeCompat, hard-link writes and async payload race');

// Read-only host components receive detached records and metadata-only listings.
const readOnly = os.createSandbox(os.processes.spawn({id:'read-only-records',manifest:{capabilities:[],fileSystem:{read:[allowed],write:[]}}}, {cwd:allowed}));
const directoryView = readOnly.fs.resolve(allowed);
assert(directoryView.children.every(entry => !Object.hasOwn(entry,'content') && !Object.hasOwn(entry,'children')));
directoryView.children.length = 0;
assert(os.fs.list(allowed).length > 0, 'directory snapshot mutation changed the VFS');
const fileView = readOnly.fs.resolve(`${allowed}/own.txt`);
fileView.content = 'detached edit'; fileView.permissions = '777';
assert.equal(os.fs.readFile(`${allowed}/own.txt`),'inside changed');
assert.notEqual(os.fs.stat(`${allowed}/own.txt`).permissions,'777');
const privatePath = `${allowed}/private.txt`;
os.fs.createFile(privatePath,'/',{content:'synthetic restricted contents',owner:'root',group:'root',permissions:'-rw-------'});
assert.throws(() => readOnly.fs.readFile(privatePath), /permission denied/i);
assert.throws(() => readOnly.fs.resolve(privatePath), /permission denied/i);
assert.throws(() => readOnly.fs.resolveNode({path:privatePath}), /permission denied/i);
assert.throws(() => sandbox.openPath(privatePath), /permission denied/i);
assert.throws(() => sandbox.openNode({path:privatePath}), /permission denied/i);
const listing = readOnly.fs.list(allowed);
assert(listing.every(entry => !Object.hasOwn(entry,'content') && !Object.hasOwn(entry,'children')));
listing.find(entry => entry.path === privatePath).permissions='777';
assert.equal(os.fs.stat(privatePath).permissions,'-rw-------');
os.fs.createFile(`${allowed}/snapshot.bin`,'/',{content:'',owner:'guest',group:'users'});
os.fs.writeFileBytes(`${allowed}/snapshot.bin`,new Uint8Array([7,8,9]));
const bytesView=readOnly.fs.resolve(`${allowed}/snapshot.bin`);
bytesView.content.bytes[0]=99;
assert.equal(os.fs.readFileBytes(`${allowed}/snapshot.bin`)[0],7,'binary snapshots share no kernel buffer');
const created = sandbox.fs.createFile(`${allowed}/detached-create.txt`,'/',{content:'created'});
created.permissions='777';
assert.notEqual(os.fs.stat(created.path).permissions,'777','mutation result shared a live VFS record');
console.log('filesystem facade snapshots smoke passed: detached records, metadata-only children, private content denial and copied binary buffers');
