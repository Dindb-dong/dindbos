import assert from "node:assert/strict";
import { MAX_WAD_BYTES, validateIWAD } from "../src/demo/apps/doom-wad.js";

const wad = new Uint8Array(32);
const view = new DataView(wad.buffer);
const encoder = new TextEncoder();
wad.set(encoder.encode("IWAD"));
view.setUint32(4, 1, true);
view.setUint32(8, 16, true);
view.setUint32(16, 12, true);
view.setUint32(20, 4, true);
wad.set(encoder.encode("E1M1"), 24);

assert.equal(validateIWAD(wad), "shareware");
wad.set(encoder.encode("MAP01"), 24);
assert.equal(validateIWAD(wad), "commercial");
assert.throws(() => validateIWAD(wad.subarray(0, 11)), /Choose a Doom IWAD/);
assert.throws(() => validateIWAD(wad.subarray(0, 31)), /directory/);
view.setUint32(20, 21, true);
assert.throws(() => validateIWAD(wad), /lump extends/);
assert.throws(() => validateIWAD(new Uint8Array(MAX_WAD_BYTES + 1)), /64 MiB/);
console.log("Doom IWAD validation smoke passed.");
