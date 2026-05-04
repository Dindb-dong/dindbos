# DindbOS Package Signatures

DindbOS currently installs local, remote, and registry packages from `dindbos.app.json` manifests. Remote package records are marked untrusted until manifest signatures are implemented.

This document defines the signature model that package verification should implement next.

## Goals

- Verify that a remote manifest was signed by a trusted publisher.
- Bind the manifest, package files, and declared file integrity hashes to the signed payload.
- Fail closed before writing package files, launchers, package records, or app registry entries.
- Keep unsigned local development packages possible, but clearly labeled as local or unsigned.

## Non-Goals

- Do not pretend browser package signatures provide native OS security.
- Do not execute lifecycle scripts as part of verification.
- Do not trust a registry entry by itself. A registry can point to a manifest, but the publisher signature is the package identity.

## Public Key Format

Use Ed25519 public keys encoded as multibase-style strings:

```text
ed25519-pub:v1:<base64url-raw-32-byte-public-key>
```

Example manifest field:

```json
{
  "publisher": {
    "id": "com.example",
    "name": "Example Publisher",
    "publicKey": "ed25519-pub:v1:W3Jx..."
  }
}
```

The runtime trust store should be a VFS JSON file:

```text
/etc/dindbos/trusted-publishers.json
```

Suggested shape:

```json
{
  "publishers": [
    {
      "id": "com.example",
      "name": "Example Publisher",
      "publicKey": "ed25519-pub:v1:W3Jx...",
      "addedAt": "2026-05-04T00:00:00.000Z"
    }
  ]
}
```

## Signed Manifest Fields

The manifest should include a detached signature block:

```json
{
  "id": "notes-pro",
  "name": "Notes Pro",
  "version": "1.0.0",
  "publisher": {
    "id": "com.example",
    "publicKey": "ed25519-pub:v1:W3Jx..."
  },
  "files": [
    {
      "path": "app.js",
      "url": "app.js",
      "integrity": "sha256-..."
    }
  ],
  "signature": {
    "algorithm": "ed25519",
    "keyId": "ed25519-pub:v1:W3Jx...",
    "payload": "dindbos-manifest-v1",
    "value": "ed25519-sig:v1:<base64url-raw-64-byte-signature>"
  }
}
```

The signed payload must be canonical JSON with the `signature` field removed.

Canonicalization rules:

- UTF-8 JSON.
- Object keys sorted lexicographically.
- No insignificant whitespace.
- Arrays preserve order.
- Strings use JSON escaping rules.
- Numbers are serialized as JSON numbers, not locale strings.

## File Integrity Binding

Remote file entries must include `integrity`.

Verification order:

1. Fetch manifest.
2. Parse JSON.
3. Validate publisher and public key shape.
4. Canonicalize manifest without `signature`.
5. Verify Ed25519 signature against the canonical payload.
6. Verify publisher key exists in `/etc/dindbos/trusted-publishers.json`, unless the user explicitly allows an unsigned/untrusted install.
7. Fetch package files.
8. Verify each file integrity hash.
9. Start the package install transaction.
10. Write files, package record, launcher, and app registration.

No package filesystem mutation should happen before signature and file integrity checks pass.

## Trust States

Package records should use these trust states:

```json
{
  "trust": {
    "source": "remote",
    "registry": "community",
    "trusted": false,
    "signature": {
      "status": "missing",
      "publisherId": "",
      "keyId": "",
      "algorithm": ""
    },
    "warnings": [
      "remote manifest is untrusted until package signatures are implemented"
    ]
  }
}
```

Supported statuses:

- `local`: installed from local VFS source.
- `missing`: remote manifest has no signature.
- `untrusted-key`: signature is valid, but the key is not in the trust store.
- `invalid`: signature verification failed.
- `valid`: signature is valid and the publisher key is trusted.

`trusted` is true only for `local` or `valid`.

## Verification Failure UX

Terminal:

```text
pkg: signature missing for https://example.com/app/dindbos.app.json
pkg: signature invalid for notes-pro
pkg: publisher com.example is not trusted
```

Package UI:

- Show the publisher name and key ID.
- Show whether the package is local, unsigned, invalid, or trusted.
- Require an explicit user action before installing unsigned remote packages.
- Never create a launcher for invalid signatures.

Registry search:

- Show unsigned remote packages as untrusted.
- Do not imply a package is trusted because it appears in a registry.

## Implementation Notes

Browser support should use Web Crypto when Ed25519 is available. If Ed25519 is not available in the current browser, the runtime should fail verification with a clear unsupported-crypto message instead of silently installing as trusted.

The package transaction rollback path should remain in place even after signature verification is added. Signature verification prevents known bad installs before mutation; rollback still protects against later file, storage, or registry failures.
