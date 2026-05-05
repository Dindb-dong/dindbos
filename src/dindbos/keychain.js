const KEYCHAIN_ROOT = "/var/lib/dindbos/keychain";
const KEYCHAIN_AUDIT_LOG = "/var/log/dindbos/keychain.log";
const DEFAULT_GRANT_TTL_MS = 5 * 60 * 1000;

export class KeychainManager {
  constructor(os) {
    this.os = os;
    this.vaults = new Map();
    this.system = os.permissions.systemPrincipal();
  }

  status(context = {}) {
    const vault = this.vaultFor(context);
    return {
      user: vault.user,
      locked: !vault.unlocked,
      records: vault.records.size,
      grants: [...vault.records.values()].reduce((total, record) => total + record.grants.length, 0),
      unlockMethod: vault.unlockMethod,
      fallbackWarning: vault.fallbackWarning,
      webCrypto: Boolean(globalThis.crypto?.getRandomValues),
      passkeySupported: this.passkeySupported(),
      passkeyEnrolled: Boolean(vault.passkey?.credentialId),
      passkeyCredentialId: vault.passkey?.credentialId || "",
      passkeyLabel: vault.passkey?.label || "",
    };
  }

  lock(context = {}) {
    const vault = this.vaultFor(context);
    vault.unlocked = false;
    vault.lockedAt = new Date().toISOString();
    this.audit(vault, "lock", "-", requesterId(context), "allowed");
    this.writeMetadata(vault);
    return this.status(context);
  }

  unlock(passphrase = "", context = {}) {
    const vault = this.vaultFor(context);
    vault.unlocked = true;
    vault.unlockedAt = new Date().toISOString();
    vault.unlockMethod = passphrase ? "password-derived-fallback" : "session";
    vault.fallbackWarning = passphrase ? "weaker-than-passkey" : "";
    this.audit(vault, "unlock", "-", requesterId(context), "allowed");
    this.writeMetadata(vault);
    return this.status(context);
  }

  async enrollPasskey(options = {}, context = {}) {
    const vault = this.vaultFor(context);
    this.assertUnlocked(vault, "passkey-enroll", context);
    const provider = this.passkeyProvider();
    if (!provider?.create) {
      this.audit(vault, "passkey-enroll", "-", requesterId(context), "denied", "unsupported");
      throw new Error("keychain: passkey WebAuthn unavailable");
    }
    const userId = randomBytes(16);
    const credential = await provider.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: "DindbOS" },
        user: {
          id: userId,
          name: vault.user,
          displayName: vault.user,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
        timeout: 60000,
        attestation: "none",
      },
    });
    const credentialId = credentialIdFrom(credential);
    if (!credentialId) throw new Error("keychain: passkey enrollment returned no credential id");
    vault.passkey = {
      credentialId,
      rawId: credentialRawIdFrom(credential),
      label: String(options.label || "default"),
      enrolledAt: new Date().toISOString(),
      lastUsedAt: "",
      userVerification: "required",
    };
    this.audit(vault, "passkey-enroll", "-", requesterId(context), "allowed", `credential=${credentialId}`);
    this.writeMetadata(vault);
    return this.status(context);
  }

  async unlockWithPasskey(context = {}) {
    return this.verifyPasskey("unlock", context);
  }

  async reauthenticateWithPasskey(context = {}) {
    return this.verifyPasskey("reauthenticate", context);
  }

  async verifyPasskey(action, context = {}) {
    const vault = this.vaultFor(context);
    const passkey = vault.passkey || {};
    if (!passkey.credentialId) {
      this.audit(vault, action, "-", requesterId(context), "denied", "no-passkey");
      throw new Error("keychain: passkey not enrolled");
    }
    const provider = this.passkeyProvider();
    if (!provider?.get) {
      this.audit(vault, action, "-", requesterId(context), "denied", "unsupported");
      throw new Error("keychain: passkey WebAuthn unavailable");
    }
    const assertion = await provider.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{
          id: passkey.rawId ? base64UrlToBytes(passkey.rawId) : textBytes(passkey.credentialId),
          type: "public-key",
        }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    const credentialId = credentialIdFrom(assertion);
    if (credentialId && credentialId !== passkey.credentialId) {
      this.audit(vault, action, "-", requesterId(context), "denied", "credential-mismatch");
      throw new Error("keychain: passkey credential mismatch");
    }
    vault.unlocked = true;
    vault.unlockedAt = new Date().toISOString();
    vault.unlockMethod = "passkey-webauthn";
    vault.fallbackWarning = "";
    vault.passkey.lastUsedAt = new Date().toISOString();
    this.audit(vault, action, "-", requesterId(context), "allowed", "method=passkey");
    this.writeMetadata(vault);
    return this.status(context);
  }

  list(context = {}) {
    const vault = this.vaultFor(context);
    this.assertUnlocked(vault, "list", context);
    return [...vault.records.values()]
      .filter((record) => this.canReadRecord(vault, record, context))
      .map(publicRecord);
  }

  setSecret(name, value, options = {}, context = {}) {
    const vault = this.vaultFor(context);
    this.assertUnlocked(vault, "set", context, name);
    const id = normalizeName(name);
    const now = new Date().toISOString();
    const ownerAppId = String(options.ownerAppId || requesterId(context));
    const existing = vault.records.get(id);
    const record = {
      name: id,
      kind: String(options.kind || existing?.kind || "generic"),
      ownerAppId,
      secretRef: existing?.secretRef || `secret:${randomId()}`,
      encrypted: true,
      exportable: Boolean(options.exportable),
      publicKey: options.publicKey || existing?.publicKey || "",
      publisherId: options.publisherId || existing?.publisherId || "",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      grants: existing?.grants || [],
    };
    vault.records.set(id, record);
    vault.values.set(id, String(value ?? ""));
    this.audit(vault, "set", id, requesterId(context), "allowed");
    this.writeMetadata(vault);
    return publicRecord(record);
  }

  getSecret(name, context = {}) {
    const vault = this.vaultFor(context);
    const id = normalizeName(name);
    this.assertUnlocked(vault, "get", context, id);
    const record = this.requireRecord(vault, id, context, "get");
    if (!this.canReadRecord(vault, record, context)) {
      this.audit(vault, "get", id, requesterId(context), "denied");
      throw new Error(`keychain: ${id}: access denied`);
    }
    this.audit(vault, "get", id, requesterId(context), "allowed");
    return { ...publicRecord(record), value: vault.values.get(id) || "" };
  }

  exportSecret(name, context = {}) {
    const vault = this.vaultFor(context);
    const id = normalizeName(name);
    this.assertUnlocked(vault, "export", context, id);
    const record = this.requireRecord(vault, id, context, "export");
    if (!this.canReadRecord(vault, record, context)) {
      this.audit(vault, "export", id, requesterId(context), "denied", "no-grant");
      throw new Error(`keychain: ${id}: access denied`);
    }
    if (!record.exportable) {
      this.audit(vault, "export", id, requesterId(context), "denied", "not-exportable");
      throw new Error(`keychain: ${id}: export denied by policy`);
    }
    this.audit(vault, "export", id, requesterId(context), "allowed");
    return {
      kind: "dindbos-keychain-export-v1",
      exportedAt: new Date().toISOString(),
      record: publicRecord(record),
      value: vault.values.get(id) || "",
    };
  }

  deleteSecret(name, context = {}) {
    const vault = this.vaultFor(context);
    const id = normalizeName(name);
    this.assertUnlocked(vault, "delete", context, id);
    const record = this.requireRecord(vault, id, context, "delete");
    this.assertOwnerOrAdmin(vault, record, context, "delete");
    vault.records.delete(id);
    vault.values.delete(id);
    this.audit(vault, "delete", id, requesterId(context), "allowed");
    this.writeMetadata(vault);
    return publicRecord(record);
  }

  grant(name, appId, options = {}, context = {}) {
    const vault = this.vaultFor(context);
    const id = normalizeName(name);
    const target = normalizeAppId(appId);
    this.assertUnlocked(vault, "grant", context, id);
    const record = this.requireRecord(vault, id, context, "grant");
    this.assertOwnerOrAdmin(vault, record, context, "grant");
    const ttlMs = Number(options.ttlMs || DEFAULT_GRANT_TTL_MS);
    const expiresAt = options.expiresAt || new Date(Date.now() + ttlMs).toISOString();
    record.grants = record.grants.filter((grant) => grant.appId !== target);
    record.grants.push({ appId: target, grantedAt: new Date().toISOString(), expiresAt });
    record.updatedAt = new Date().toISOString();
    this.audit(vault, "grant", id, requesterId(context), "allowed", `target=${target}`);
    this.writeMetadata(vault);
    return publicRecord(record);
  }

  revoke(name, appId, context = {}) {
    const vault = this.vaultFor(context);
    const id = normalizeName(name);
    const target = normalizeAppId(appId);
    this.assertUnlocked(vault, "revoke", context, id);
    const record = this.requireRecord(vault, id, context, "revoke");
    this.assertOwnerOrAdmin(vault, record, context, "revoke");
    record.grants = record.grants.filter((grant) => grant.appId !== target);
    record.updatedAt = new Date().toISOString();
    this.audit(vault, "revoke", id, requesterId(context), "allowed", `target=${target}`);
    this.writeMetadata(vault);
    return publicRecord(record);
  }

  createSigningKey(name, publisherId, context = {}) {
    const publicKey = `ed25519-pub:v1:${base64Url(randomBytes(32))}`;
    return this.setSecret(name, `signing-key-ref:${randomId()}`, {
      kind: "package-signing-key",
      publisherId: String(publisherId || ""),
      publicKey,
    }, context);
  }

  signingKey(name, context = {}) {
    const record = this.getSecret(name, context);
    if (record.kind !== "package-signing-key") throw new Error(`keychain: ${name}: not a package signing key`);
    const { value, ...publicKeyRecord } = record;
    return publicKeyRecord;
  }

  auditEntries(context = {}) {
    const vault = this.vaultFor(context);
    return [...vault.audit];
  }

  settingsStatus(context = {}) {
    const vault = this.vaultFor(context);
    const status = this.status(context);
    const now = Date.now();
    const staleBefore = now - (90 * 24 * 60 * 60 * 1000);
    const records = [...vault.records.values()];
    const activeGrants = records.flatMap((record) => record.grants
      .filter((grant) => !grant.expiresAt || Date.parse(grant.expiresAt) > now)
      .map((grant) => ({
        name: record.name,
        kind: record.kind,
        appId: grant.appId,
        grantedAt: grant.grantedAt,
        expiresAt: grant.expiresAt || "",
      })));
    const staleCredentials = records
      .filter((record) => Date.parse(record.updatedAt || record.createdAt || "") < staleBefore)
      .map((record) => ({
        name: record.name,
        kind: record.kind,
        ownerAppId: record.ownerAppId,
        updatedAt: record.updatedAt,
      }));
    const deniedRequests = vault.audit
      .filter((entry) => entry.result === "denied")
      .slice(-20)
      .map((entry) => ({ ...entry }));
    const nonExportable = records.filter((record) => !record.exportable).length;
    const exportWarnings = [
      nonExportable ? `${nonExportable} secret${nonExportable === 1 ? "" : "s"} require keychain-mediated export` : "",
      "raw secret values are excluded from ordinary package and filesystem exports",
    ].filter(Boolean);
    const recoveryWarnings = [
      vault.fallbackWarning ? `unlock fallback: ${vault.fallbackWarning}` : "",
      status.locked ? "vault locked; recovery package export requires unlock" : "",
      "recovery packages must be explicitly exported by the keychain service",
    ].filter(Boolean);
    return {
      ...status,
      activeGrants,
      deniedRequests,
      staleCredentials,
      exportWarnings,
      recoveryWarnings,
    };
  }

  vaultFor(context = {}) {
    const user = context.principal?.user || this.os.session?.user || "guest";
    if (!this.vaults.has(user)) {
      const vault = {
        user,
        unlocked: true,
        unlockedAt: new Date().toISOString(),
        lockedAt: "",
        unlockMethod: "session",
        fallbackWarning: "",
        records: new Map(),
        values: new Map(),
        audit: [],
      };
      this.vaults.set(user, vault);
    }
    return this.vaults.get(user);
  }

  assertUnlocked(vault, action, context, name = "-") {
    if (vault.unlocked) return;
    this.audit(vault, action, name, requesterId(context), "denied", "locked");
    throw new Error("keychain: vault locked");
  }

  requireRecord(vault, name, context, action) {
    const record = vault.records.get(name);
    if (record) return record;
    this.audit(vault, action, name, requesterId(context), "denied", "missing");
    throw new Error(`keychain: ${name}: no such secret`);
  }

  assertOwnerOrAdmin(vault, record, context, action) {
    if (isAdminContext(context) || requesterId(context) === record.ownerAppId) return;
    this.audit(vault, action, record.name, requesterId(context), "denied", "not-owner");
    throw new Error(`keychain: ${record.name}: manage denied`);
  }

  canReadRecord(vault, record, context) {
    const requester = requesterId(context);
    if (isAdminContext(context) || requester === record.ownerAppId) return true;
    const now = Date.now();
    record.grants = record.grants.filter((grant) => !grant.expiresAt || Date.parse(grant.expiresAt) > now);
    return record.grants.some((grant) => grant.appId === requester);
  }

  audit(vault, action, name, requester, result, detail = "") {
    const entry = {
      at: new Date().toISOString(),
      user: vault.user,
      action,
      name,
      requester,
      result,
      detail,
    };
    vault.audit.push(entry);
    vault.audit = vault.audit.slice(-200);
    this.appendAuditLog(entry);
  }

  writeMetadata(vault) {
    this.ensureStorageRoots();
    const userDir = `${KEYCHAIN_ROOT}/${vault.user}`;
    ensureDirectory(this.os, userDir, this.system, { owner: vault.user, group: "users", permissions: "drwx------" });
    const payload = {
      user: vault.user,
      locked: !vault.unlocked,
      unlockMethod: vault.unlockMethod,
      fallbackWarning: vault.fallbackWarning,
      records: [...vault.records.values()].map(publicRecord),
      passkey: publicPasskey(vault.passkey),
      auditRecords: vault.audit.length,
    };
    this.os.fs.writeOrCreateFile(`${userDir}/records.json`, `${JSON.stringify(payload, null, 2)}\n`, "/", {
      mime: "application/json",
      owner: vault.user,
      group: "users",
      permissions: "-rw-------",
    }, this.system);
  }

  appendAuditLog(entry) {
    this.ensureStorageRoots();
    const line = `${entry.at} user=${entry.user} action=${entry.action} name=${entry.name} requester=${entry.requester} result=${entry.result}${entry.detail ? ` ${entry.detail}` : ""}\n`;
    if (this.os.fs.exists(KEYCHAIN_AUDIT_LOG)) this.os.fs.appendFile(KEYCHAIN_AUDIT_LOG, line, "/", this.system);
    else this.os.fs.writeOrCreateFile(KEYCHAIN_AUDIT_LOG, line, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-------",
    }, this.system);
  }

  ensureStorageRoots() {
    ["/var", "/var/lib", "/var/lib/dindbos", KEYCHAIN_ROOT, "/var/log", "/var/log/dindbos"].forEach((path) => {
      ensureDirectory(this.os, path, this.system);
    });
  }

  passkeyProvider() {
    return this.os.webAuthn || this.os.webauthn || globalThis.navigator?.credentials || null;
  }

  passkeySupported() {
    const provider = this.passkeyProvider();
    return Boolean(provider?.create && provider?.get);
  }
}

function publicRecord(record) {
  return {
    name: record.name,
    kind: record.kind,
    ownerAppId: record.ownerAppId,
    secretRef: record.secretRef,
    encrypted: Boolean(record.encrypted),
    exportable: Boolean(record.exportable),
    publicKey: record.publicKey || "",
    publisherId: record.publisherId || "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    grants: record.grants.map((grant) => ({ ...grant })),
  };
}

function publicPasskey(passkey = null) {
  if (!passkey?.credentialId) return null;
  return {
    credentialId: passkey.credentialId,
    label: passkey.label || "",
    enrolledAt: passkey.enrolledAt || "",
    lastUsedAt: passkey.lastUsedAt || "",
    userVerification: passkey.userVerification || "required",
  };
}

function ensureDirectory(os, path, principal, options = {}) {
  if (os.fs.exists(path)) return;
  const parent = os.fs.dirname(path);
  if (parent && parent !== path && !os.fs.exists(parent)) ensureDirectory(os, parent, principal, options);
  os.fs.createDirectory(path, "/", {
    owner: options.owner || "root",
    group: options.group || "root",
    permissions: options.permissions || "drwxr-xr-x",
  }, principal);
}

function requesterId(context = {}) {
  return String(context.process?.appId || context.appId || "shell");
}

function isAdminContext(context = {}) {
  return Boolean(context.principal?.system || context.system || requesterId(context) === "shell");
}

function normalizeName(name) {
  const value = String(name || "").trim();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value)) throw new Error(`keychain: invalid secret name: ${name || ""}`);
  return value;
}

function normalizeAppId(appId) {
  const value = String(appId || "").trim();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value)) throw new Error(`keychain: invalid app id: ${appId || ""}`);
  return value;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function randomId() {
  return base64Url(randomBytes(18));
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function credentialIdFrom(credential = {}) {
  if (credential.id) return String(credential.id);
  return credentialRawIdFrom(credential);
}

function credentialRawIdFrom(credential = {}) {
  if (!credential.rawId) return "";
  return base64Url(new Uint8Array(credential.rawId));
}

function base64UrlToBytes(value = "") {
  const padded = `${String(value).replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (String(value).length % 4)) % 4)}`;
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function textBytes(value = "") {
  if (globalThis.TextEncoder) return new TextEncoder().encode(String(value));
  return Uint8Array.from(String(value), (char) => char.charCodeAt(0));
}
