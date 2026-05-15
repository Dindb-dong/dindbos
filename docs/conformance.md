# DindbOS Conformance Lab

DindbOS compatibility claims are generated from runtime conformance output. The report classifies each subsystem as `supported`, `partial`, `degraded`, `companion-required`, `planned`, or `unsupported`.

Run:

```text
npm run release:conformance
conformance
conformance matrix
conformance evidence
conformance evidence json
conformance json
doctor conformance
cat /proc/conformance
cat /proc/conformance.json
cat /proc/conformance-evidence
cat /proc/conformance-evidence.json
```

## Certification Areas

- `durable-disk`: storage backend, writeback, fsck, recovery diagnostics.
- `descriptor-io`: file descriptors, handles, pipes, and procfs handle views.
- `package-platform`: package install, trust, namespace policy, app registry, package CLI.
- `wasm`: DindbOS ABI/WASI subset, memory limits, deadline guards, worker output backend.
- `nodecompat`: browser-safe npm and NodeCompat module surface.
- `worker-isolation`: worker process executor and memory-region diagnostics.
- `app-containers`: same-realm hardening, iframe bridge, process container health.
- `device-brokers`: browser API brokers, `/dev/browser`, privacy ledger, revocation.
- `virtual-networking`: network broker, loopback services, firewall/service diagnostics.
- `companion-trust`: explicit local/remote helper protocol boundaries.
- `service-worker-recovery`: Service Worker boot manifest, safe boot profiles, offline maintenance queue.
- `cross-origin-isolation`: COOP/COEP/CORP and SharedArrayBuffer readiness.
- `policy-trust`: package policy compiler, trust state, and denial proof descriptors.

## Browser Matrix

The generated matrix includes Chromium tabs, Safari tabs, Firefox tabs, mobile browsers, installed PWA mode, cross-origin-isolated deployments, local companions, and remote providers. Each profile keeps limitations explicit instead of folding them into a generic "works everywhere" claim.

Each matrix row also reports QA evidence count, latest evidence status, latest runner, and latest timestamp when records are present. Evidence records are normalized as:

```json
{
  "profile": "chromium-tab",
  "status": "pass",
  "runner": "playwright-chromium",
  "categories": ["package-platform", "policy-trust"],
  "artifacts": ["/var/log/dindbos/qa/chromium-tab.json"]
}
```

Runtime callers can append records with `os.addConformanceEvidence(record)`. DindbOS mirrors them to `/var/run/dindbos/conformance-evidence.json`, `/proc/conformance-evidence`, and `/proc/conformance-evidence.json`.

`npm run release:conformance` boots a headless DindbOS runtime and writes immutable release evidence to `dist/release-conformance`:

- `dindbos-conformance.json`
- `dindbos-conformance-evidence.json`
- `dindbos-secure-boot.json`
- `dindbos-release-manifest.json`
- `dindbos-release-manifest.sig.json`
- `dindbos-release-verification.json`
- `SHA256SUMS`

The release manifest records the package version, git commit, dirty-worktree flag, source tree aggregate digest, conformance summary, secure boot summary, and SHA-256 digest for every core evidence artifact. `dindbos-release-manifest.sig.json` is a detached Ed25519 signature over the manifest bytes and manifest digest. `dindbos-release-verification.json` records the verifier result, key id, signature file, and manifest digest. Production release jobs should provide `DINDBOS_RELEASE_SIGNING_KEY_PEM`; local smoke runs use an ephemeral Ed25519 key so verification behavior stays testable without committing release secrets.

`npm run smoke:conformance` verifies report generation, shell formatting, matrix output, QA evidence output, and `doctor conformance`.
`npm run smoke:release-conformance` verifies release artifact generation, secure boot status, manifest records, Ed25519 signature verification, tamper rejection, and SHA-256 digest lines.
