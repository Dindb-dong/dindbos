const LEGACY_BYTE_CONTENT_KIND = "dindbos-bytes-v1";
const NATIVE_BYTE_CONTENT_KIND = "dindbos-file-bytes-v2";
const CONTENT_RECORD_KIND = "dindbos-content-record-v1";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function normalizeFileContent(value, options = {}) {
  if (isNativeByteContent(value)) return bytesContent(value.bytes, { mime: options.mime || value.mime });
  if (isLegacyByteContent(value)) return bytesContent(base64ToBytes(value.data), { mime: options.mime || value.mime });
  if (value instanceof Uint8Array) return bytesContent(value, options);
  if (value instanceof ArrayBuffer) return bytesContent(new Uint8Array(value), options);
  if (ArrayBuffer.isView(value)) return bytesContent(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), options);
  return String(value ?? "");
}

export async function normalizeFileContentAsync(value, options = {}) {
  if (isBlobLike(value)) {
    return bytesContent(new Uint8Array(await value.arrayBuffer()), { mime: options.mime || value.type || "" });
  }
  return normalizeFileContent(value, options);
}

export function fileContentToText(content) {
  if (isByteContent(content)) return textDecoder.decode(byteContentBytes(content));
  return String(content ?? "");
}

export function fileContentToBytes(content) {
  if (isByteContent(content)) return copyBytes(byteContentBytes(content));
  return textEncoder.encode(String(content ?? ""));
}

export function fileContentByteLength(content) {
  if (isByteContent(content)) return byteContentBytes(content).byteLength;
  return textEncoder.encode(String(content ?? "")).byteLength;
}

export function cloneFileContent(content) {
  if (isByteContent(content)) return bytesContent(byteContentBytes(content), { mime: content.mime || "" });
  return String(content ?? "");
}

export function serializeFileContentRecord(content) {
  const normalized = normalizeFileContent(content);
  return JSON.stringify({
    kind: CONTENT_RECORD_KIND,
    content: serializeContentPayload(normalized),
  });
}

export function parseFileContentRecord(record) {
  try {
    const parsed = JSON.parse(record);
    if (parsed?.kind === CONTENT_RECORD_KIND) return normalizeFileContent(parsed.content);
  } catch {}
  return String(record ?? "");
}

export function fileContentPreview(content, limit = 4096) {
  const text = fileContentToText(content);
  return text.length > limit ? `${text.slice(0, limit)}\n...` : text;
}

export function isByteContent(value) {
  return isNativeByteContent(value) || isLegacyByteContent(value);
}

function bytesContent(bytes, options = {}) {
  const normalized = copyBytes(bytes);
  return {
    kind: NATIVE_BYTE_CONTENT_KIND,
    bytes: normalized,
    size: normalized.byteLength,
    mime: options.mime || "",
  };
}

function serializeContentPayload(content) {
  if (!isByteContent(content)) return content;
  return {
    kind: LEGACY_BYTE_CONTENT_KIND,
    encoding: "base64",
    data: bytesToBase64(byteContentBytes(content)),
    mime: content.mime || "",
  };
}

function isNativeByteContent(value) {
  return Boolean(value && typeof value === "object" && value.kind === NATIVE_BYTE_CONTENT_KIND && value.bytes instanceof Uint8Array);
}

function isLegacyByteContent(value) {
  return Boolean(value && typeof value === "object" && value.kind === LEGACY_BYTE_CONTENT_KIND && value.encoding === "base64" && typeof value.data === "string");
}

function byteContentBytes(content) {
  if (isNativeByteContent(content)) return content.bytes;
  return base64ToBytes(content.data);
}

function copyBytes(bytes) {
  if (bytes instanceof Uint8Array) return new Uint8Array(bytes);
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes.slice(0));
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return new Uint8Array(bytes || []);
}

function isBlobLike(value) {
  return Boolean(value && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.size === "number");
}

export function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToBytes(value) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
