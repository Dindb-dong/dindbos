import { fileContentToText } from "../file-data.js";

export const FILE_TAG_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "gray"];
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1000;
const MAX_TAG_STORE_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

/** Commands operate through the same permission-checked facade as Files. */
export async function executeFilesContextCommand(os, currentPath, targetPath, action, state = {}) {
  if (action === "compress") return compressItems(os, currentPath, targetPath, state);
  if (action === "make-alias") {
    if (typeof os.fs.createSymlink !== "function") throw new Error("Aliases are unavailable in this desktop.");
    if (os.localMounts?.isMountedPath(targetPath)) throw new Error("Aliases are unavailable in mounted folders.");
    const destination = await uniqueSibling(os, os.fs.dirname(targetPath), `${os.fs.basename(targetPath)} alias`);
    os.fs.createSymlink(targetPath, destination);
    return { path: currentPath, selectedPath: destination };
  }
  if (action.startsWith("tag:")) {
    const color = action.slice(4);
    if (color !== "none" && !FILE_TAG_COLORS.includes(color)) throw new Error("Unknown tag color.");
    const store = readTagStore(os);
    const targets = selectedTargets(os, currentPath, targetPath, state);
    for (const target of targets) {
      if (!os.fs.lstat(target)) throw new Error(`Item no longer exists: ${target}`);
      const previous = store.files[target] || [];
      const tags = color === "none" ? [] : previous.includes(color) ? previous.filter(value => value !== color) : [...previous, color];
      if (tags.length) store.files[target] = tags;
      else delete store.files[target];
    }
    writeTagStore(os, store);
    return { path: currentPath, selectedPath: targetPath };
  }
  return null;
}

export function readFilesTags(os, targetPath) {
  return [...(readTagStore(os).files[os.fs.normalize(targetPath)] || [])];
}

/** Call after a successful move; a folder move also relocates its descendants. */
export function remapFilesTags(os, sourcePath, destinationPath) {
  const source = os.fs.normalize(sourcePath);
  const destination = os.fs.normalize(destinationPath);
  if (source === destination || !os.fs.exists(tagStorePath(os))) return false;
  const store = readTagStore(os);
  const moved = Object.entries(store.files).filter(([path]) => path === source || path.startsWith(`${source}/`));
  if (!moved.length) return false;
  for (const [path] of moved) delete store.files[path];
  for (const [path, tags] of moved) store.files[destination + path.slice(source.length)] = tags;
  writeTagStore(os, store);
  return true;
}

/** Call after permanent deletion to avoid tagging a new item at the same path. */
export function forgetFilesTags(os, targetPath) {
  const target = os.fs.normalize(targetPath);
  if (!os.fs.exists(tagStorePath(os))) return false;
  const store = readTagStore(os);
  const removed = Object.keys(store.files).filter(path => path === target || path.startsWith(`${target}/`));
  if (!removed.length) return false;
  for (const path of removed) delete store.files[path];
  writeTagStore(os, store);
  return true;
}

function writeTagStore(os, store) {
  const serialized = JSON.stringify(store);
  if (encoder.encode(serialized).length > MAX_TAG_STORE_BYTES) throw new Error("The Finder tag store is full.");
  const destination = tagStorePath(os);
  ensureDirectory(os, os.fs.dirname(destination));
  os.fs.atomicWriteOrCreateFile(destination, serialized, "/", { mime: "application/json" });
}

function tagStorePath(os) { return os.fs.join(os.session.home || "/home/guest", ".config/dindbos/file-tags.json"); }

function readTagStore(os) {
  const path = tagStorePath(os);
  if (!os.fs.exists(path)) return { version: 1, files: {} };
  const text = fileContentToText(os.fs.readFile(path));
  if (encoder.encode(text).length > MAX_TAG_STORE_BYTES) throw new Error("Finder tag data is too large; original data was preserved.");
  let value;
  try { value = JSON.parse(text); } catch { throw new Error("Finder tag data is invalid; original data was preserved."); }
  if (!value || value.version !== 1 || !value.files || typeof value.files !== "object" || Array.isArray(value.files)) throw new Error("Finder tag data has an unsupported format; original data was preserved.");
  for (const [path, tags] of Object.entries(value.files)) {
    if (!path.startsWith("/") || !Array.isArray(tags) || tags.some(tag => !FILE_TAG_COLORS.includes(tag))) throw new Error("Finder tag data is invalid; original data was preserved.");
  }
  return value;
}

function ensureDirectory(os, path) {
  if (os.fs.exists(path)) return;
  const parent = os.fs.dirname(path);
  if (parent !== path) ensureDirectory(os, parent);
  os.fs.createDirectory(path);
}

function selectedTargets(os, currentPath, targetPath, state) {
  const target = os.fs.normalize(targetPath);
  const values = Array.isArray(state.selectedPaths) && state.selectedPaths.includes(target) ? state.selectedPaths : [target];
  const paths = [...new Set(values.map(path => os.fs.normalize(path)))];
  if (!paths.length || paths.some(path => path === "/" || path === currentPath)) throw new Error("Select a file or folder first.");
  return paths.filter(path => !paths.some(parent => parent !== path && path.startsWith(`${parent}/`)));
}

async function uniqueSibling(os, directory, filename) {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  for (let index = 1; index <= 1000; index++) {
    const candidate = os.fs.join(directory, index === 1 ? filename : `${stem} ${index}${extension}`);
    const exists = os.localMounts?.isMountedPath(candidate) ? await os.localMounts.exists(candidate) : os.fs.exists(candidate);
    if (!exists) return candidate;
  }
  throw new Error("Could not find an available archive name.");
}

async function compressItems(os, currentPath, targetPath, state) {
  const targets = selectedTargets(os, currentPath, targetPath, state);
  if (new Set(targets.map(path => os.fs.basename(path))).size !== targets.length) throw new Error("Select items with different names to create one archive.");
  const entries = [];
  let totalBytes = 0;
  const reporter = state.reporter;
  const ensureActive = () => {
    if (reporter?.signal?.aborted) { const error = new Error("Compression cancelled."); error.name = "AbortError"; throw error; }
  };
  const walk = async (path, archivePath, depth = 0) => {
    ensureActive();
    if (depth > 32) throw new Error("This folder is too deeply nested to archive.");
    if (entries.length >= MAX_ARCHIVE_ENTRIES) throw new Error(`Archives are limited to ${MAX_ARCHIVE_ENTRIES} items.`);
    const node = os.fs.lstat(path);
    if (!node) throw new Error(`Item no longer exists: ${path}`);
    if (os.fs.isLink(node)) throw new Error("This archive contains an alias. Remove it from the selection first.");
    if (["directory", "mount"].includes(node.type)) {
      entries.push({ name: `${archivePath}/`, data: new Uint8Array(), directory: true, modified: node.modified });
      if (os.localMounts?.isMountedPath(path)) await os.localMounts.syncDirectory(path);
      for (const child of os.fs.list(path)) await walk(child.path || os.fs.join(path, child.name), `${archivePath}/${child.name}`, depth + 1);
    } else {
      const stat = os.fs.stat(path);
      if (Number(stat.size) > MAX_ARCHIVE_BYTES - totalBytes) throw new Error("Archives are limited to 32 MB.");
      const data = os.localMounts?.isMountedPath(path) ? await os.localMounts.readFileBytes(path) : os.fs.readFileBytes(path);
      totalBytes += data.length;
      if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error("Archives are limited to 32 MB.");
      entries.push({ name: archivePath, data, modified: stat.modified });
    }
    reporter?.step?.(path);
    if (entries.length % 25 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  };
  reporter?.start?.(null, "Preparing ZIP archive");
  for (const path of targets) await walk(path, os.fs.basename(path));
  ensureActive();
  const bytes = createStoredZip(entries);
  const destinationDirectory = targets.length === 1 ? os.fs.dirname(targetPath) : currentPath;
  const destination = await uniqueSibling(os, destinationDirectory, targets.length === 1 ? `${os.fs.basename(targetPath)}.zip` : "Archive.zip");
  ensureActive();
  if (os.localMounts?.isMountedPath(destination)) await os.localMounts.writeFileBytes(destination, bytes, "/", { mime: "application/zip" });
  else os.fs.atomicWriteOrCreateFileBytes(destination, bytes, "/", { mime: "application/zip" });
  return { path: currentPath, selectedPath: destination };
}

/** ZIP method 0: interoperable archives, with UTF-8 names, CRC32 and no dependency. */
export function createStoredZip(entries) {
  const files = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    if (name.length > 65535 || entry.name.split("/").some(part => part === ".." || part === ".") || entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.includes("\0")) throw new Error("Unsupported archive entry name.");
    const data = entry.data;
    const checksum = crc32(data);
    const date = new Date(entry.modified || 0);
    const valid = !Number.isNaN(date.getTime()) && date.getFullYear() >= 1980 && date.getFullYear() <= 2107;
    const time = valid ? date.getHours() << 11 | date.getMinutes() << 5 | date.getSeconds() >> 1 : 0;
    const day = valid ? (date.getFullYear() - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate() : 33;
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
    l.setUint16(10, time, true); l.setUint16(12, day, true); l.setUint32(14, checksum, true);
    l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true);
    local.set(name, 30);
    const header = new Uint8Array(46 + name.length);
    const c = new DataView(header.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(12, time, true); c.setUint16(14, day, true); c.setUint32(16, checksum, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(38, entry.directory ? 0x10 : 0, true); c.setUint32(42, offset, true); header.set(name, 46);
    files.push(local, data); central.push(header); offset += local.length + data.length;
  }
  const centralLength = central.reduce((size, bytes) => size + bytes.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, centralLength, true); e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralLength + end.length);
  let cursor = 0;
  for (const part of [...files, ...central, end]) { result.set(part, cursor); cursor += part.length; }
  return result;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc >>> 8 ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
