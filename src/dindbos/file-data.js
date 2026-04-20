const BYTE_CONTENT_KIND = "dindbos-bytes-v1";
const CONTENT_RECORD_KIND = "dindbos-content-record-v1";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function normalizeFileContent(value, options = {}) {
  if (isByteContent(value)) return { ...value };
  if (value instanceof Uint8Array) return bytesContent(value, options);
  if (value instanceof ArrayBuffer) return bytesContent(new Uint8Array(value), options);
  if (ArrayBuffer.isView(value)) return bytesContent(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), options);
  return String(value ?? "");
}

export function fileContentToText(content) {
  if (isByteContent(content)) return textDecoder.decode(base64ToBytes(content.data));
  return String(content ?? "");
}

export function fileContentToBytes(content) {
  if (isByteContent(content)) return base64ToBytes(content.data);
  return textEncoder.encode(String(content ?? ""));
}

export function fileContentByteLength(content) {
  if (isByteContent(content)) return base64ToBytes(content.data).byteLength;
  return textEncoder.encode(String(content ?? "")).byteLength;
}

export function serializeFileContentRecord(content) {
  return JSON.stringify({
    kind: CONTENT_RECORD_KIND,
    content: normalizeFileContent(content),
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
  return Boolean(value && typeof value === "object" && value.kind === BYTE_CONTENT_KIND && value.encoding === "base64" && typeof value.data === "string");
}

function bytesContent(bytes, options = {}) {
  return {
    kind: BYTE_CONTENT_KIND,
    encoding: "base64",
    data: bytesToBase64(bytes),
    mime: options.mime || "",
  };
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
