#!/usr/bin/env node
import assert from 'node:assert/strict';
import { AppSandbox } from '../src/dindbos/app-sandbox.js';
import { createDindbOSTestRuntime } from './helpers/dindbos-test-runtime.js';

class FakeSocket {
  constructor() { this.listeners = {}; this.closed = false; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  close(code, reason) { this.closed = true; this.listeners.close?.({ code, reason }); }
}
class FakePeer {
  constructor() { this.closed = false; this.channel = new FakeSocket(); }
  createDataChannel() { return this.channel; }
  close() { this.closed = true; }
}
const calls = [];
const rawClosed = [];
const os = createDindbOSTestRuntime(null, {
  networkWebSocket: FakeSocket,
  networkPeerConnection: FakePeer,
  networkFetch: (url, options) => { calls.push({url, signal: options.signal}); return new Promise(() => {}); },
});
os.network.rawSocketCompanion = {
  approved: true, identity: 'networkd', protocolVersion: 'dindbos-networkd-v1', capabilities: ['rawTcp'],
  openRaw: ({id}) => ({id}), closeRaw: id => rawClosed.push(id),
};
const spawn = id => {
  const process = os.processes.spawn({id, manifest: {capabilities:['net.fetch','net.websocket','net.webrtc','net.rawTcp'], fileSystem:{read:[],write:[]},namespace:{networkHosts:['api.example.test','slow.loopback.dindbos']}}});
  return {process, sandbox: new AppSandbox(os, process)};
};
const first = spawn('shared-app');
const second = spawn('shared-app'); // Ownership must use PID, not application id.
const sockets = [first, second].map(({sandbox}) => sandbox.net.openWebSocket('wss://api.example.test/socket'));
const channels = [first, second].map(({sandbox}) => sandbox.net.openDataChannel('api.example.test'));
const raw = [first, second].map(({sandbox}) => sandbox.net.openRawSocket('tcp','api.example.test',443));
const socketInstances = sockets.map(socket => os.network.webSocketSessions.get(socket.id).socket);
const peerInstances = channels.map(channel => os.network.dataChannelSessions.get(channel.id).peerConnection);
os.network.registerLoopbackService({id:'first-owned',handler:async()=>({text:'owned'})},{process:first.process});
os.network.registerLoopbackService({id:'slow',handler:()=>new Promise(()=>{})});
const pending = first.sandbox.net.fetch('https://api.example.test/slow');
const rejected = assert.rejects(pending, /request cancelled/);
const secondPending = second.sandbox.net.fetch('https://api.example.test/second-slow');
const secondRejected = assert.rejects(secondPending, /request cancelled/);
const loopbackPending = first.sandbox.net.fetch('https://slow.loopback.dindbos/pending');
const loopbackRejected = assert.rejects(loopbackPending, /request cancelled/);
os.processes.kill(first.process.pid);
await Promise.all([rejected, loopbackRejected]);
assert(socketInstances[0].closed);
assert(peerInstances[0].channel.closed && peerInstances[0].closed);
assert(rawClosed.includes(raw[0].id));
assert(calls[0].signal.aborted);
assert.equal(os.network.pendingRequests.size,1);
assert.equal(os.network.requests.size,1);
assert(!calls[1].signal.aborted, 'other PID pending request survives');
assert(!os.network.loopbackServices.has('first-owned'));
assert(os.network.loopbackServices.has('slow'),'system service survives another PID exit');
for(const [map,items] of [[os.network.webSocketSessions,sockets],[os.network.dataChannelSessions,channels],[os.network.rawSocketSessions,raw]]) {
  assert(!map.has(items[0].id)); assert(map.has(items[1].id));
}
assert(!socketInstances[1].closed && !peerInstances[1].closed);
assert.throws(()=>first.sandbox.net.openWebSocket('wss://api.example.test/late'),/process has exited/);
os.network.cleanupOwner(first.process.pid); // Idempotent after process handles have been revoked.
// Crash teardown must work even if a driver fails while closing its transport.
const failing = second.sandbox.net.openWebSocket('wss://api.example.test/failing');
os.network.webSocketSessions.get(failing.id).socket.close = () => { throw Error('driver close failed'); };
os.processes.crash(second.process.pid, new Error('crash fixture'));
await secondRejected;
assert.equal(os.network.pendingRequests.size,0);
assert.equal(os.network.requests.size,0);
assert.equal(os.network.webSocketSessions.size,0);
assert.equal(os.network.dataChannelSessions.size,0);
assert.equal(os.network.rawSocketSessions.size,0);
assert(os.network.webSocketHistory.some(entry=>entry.id===failing.id && entry.closeError==='driver close failed'));
assert(socketInstances[1].closed && peerInstances[1].closed);
assert(rawClosed.includes(raw[1].id));
os.processes.kill(second.process.pid,'closed-after-crash');
assert.throws(()=>second.sandbox.net.openDataChannel('api.example.test'),/process has exited/);
console.log('process network cleanup smoke passed: PID ownership, exit/crash, WebSocket/WebRTC/raw, failing drivers, pending fetch/loopback abort and stale sandbox rejection');
