export const MAX_WAD_BYTES = 64 * 1024 * 1024;

export function validateIWAD(bytes) {
  if (bytes.byteLength > MAX_WAD_BYTES) throw new Error("Choose an IWAD of 64 MiB or less.");
  if (bytes.byteLength < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== "IWAD") {
    throw new Error("Choose a Doom IWAD file, such as doom.wad or doom2.wad.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lumpCount = view.getUint32(4, true);
  const directory = view.getUint32(8, true);
  // The engine copies the directory onto its wasm stack.
  if (!lumpCount || lumpCount > 32768 || directory < 12 || directory + lumpCount * 16 > bytes.byteLength) {
    throw new Error("The IWAD directory is truncated or out of range.");
  }

  const maps = new Set();
  for (let entry = directory; entry < directory + lumpCount * 16; entry += 16) {
    const position = view.getUint32(entry, true);
    const size = view.getUint32(entry + 4, true);
    if (position + size > bytes.byteLength) throw new Error("An IWAD lump extends beyond the file.");
    const name = String.fromCharCode(...bytes.subarray(entry + 8, entry + 16)).split("\0", 1)[0].toUpperCase();
    if (name === "MAP01" || /^E[1-4]M1$/.test(name)) maps.add(name);
  }

  if (maps.has("MAP01")) return "commercial";
  if (maps.has("E4M1")) return "retail";
  if (maps.has("E2M1") || maps.has("E3M1")) return "registered";
  if (maps.has("E1M1")) return "shareware";
  throw new Error("The IWAD has no recognized Doom starting map.");
}
