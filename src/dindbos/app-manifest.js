const DEFAULT_FS_READ = ["/"];
const DEFAULT_FS_WRITE = [];

export function normalizeAppManifest(app) {
  const declared = app.manifest || {};
  const fileSystem = declared.fileSystem || app.fileSystem || {};
  return {
    id: app.id,
    name: app.name || app.id,
    version: declared.version || app.version || "0.1.0",
    entry: declared.entry || app.entry || "builtin",
    description: declared.description || app.description || "",
    singleton: Boolean(app.singleton),
    pinned: Boolean(app.pinned),
    accepts: [...(app.accepts || [])],
    capabilities: [...new Set([...(declared.capabilities || []), ...(app.capabilities || [])])],
    fileSystem: {
      read: [...(fileSystem.read || DEFAULT_FS_READ)],
      write: [...(fileSystem.write || DEFAULT_FS_WRITE)],
    },
  };
}

export function canUseCapability(manifest, capability) {
  return manifest.capabilities.includes(capability);
}

export function canAccessFileSystem(manifest, path, access) {
  if (access === "read") return isInsideAny(path, [...manifest.fileSystem.read, ...manifest.fileSystem.write]);
  if (access === "write") return isInsideAny(path, manifest.fileSystem.write);
  return false;
}

export function manifestToText(manifest) {
  return [
    `id=${manifest.id}`,
    `name=${manifest.name}`,
    `version=${manifest.version}`,
    `entry=${manifest.entry}`,
    `singleton=${manifest.singleton}`,
    `pinned=${manifest.pinned}`,
    `accepts=${manifest.accepts.join(",") || "-"}`,
    `capabilities=${manifest.capabilities.join(",") || "-"}`,
    `fs.read=${manifest.fileSystem.read.join(",") || "-"}`,
    `fs.write=${manifest.fileSystem.write.join(",") || "-"}`,
  ].join("\n");
}

function isInsideAny(path, scopes) {
  return scopes.some((scope) => isInside(path, scope));
}

function isInside(path, scope) {
  if (scope === "/") return path.startsWith("/");
  const normalizedScope = scope.replace(/\/$/, "");
  return path === normalizedScope || path.startsWith(`${normalizedScope}/`);
}
