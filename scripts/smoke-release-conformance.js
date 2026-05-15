#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReleaseConformanceArtifacts, verifyReleaseManifestSignature } from "./release-conformance-artifacts.js";

const outDir = await mkdtemp(join(tmpdir(), "dindbos-release-conformance-"));

try {
  const result = await buildReleaseConformanceArtifacts({
    outDir,
    evidenceRunner: "release-conformance-smoke",
  });
  assert(result.files.includes("dindbos-conformance.json"), "conformance artifact missing");
  assert(result.files.includes("dindbos-secure-boot.json"), "secure boot artifact missing");
  assert(result.files.includes("dindbos-release-manifest.json"), "release manifest missing");
  assert(result.files.includes("dindbos-release-manifest.sig.json"), "release manifest signature missing");
  assert(result.files.includes("dindbos-release-verification.json"), "release verification artifact missing");
  assert(result.files.includes("SHA256SUMS"), "sha256 sums missing");

  const conformance = JSON.parse(await readFile(join(outDir, "dindbos-conformance.json"), "utf8"));
  const secureBoot = JSON.parse(await readFile(join(outDir, "dindbos-secure-boot.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(outDir, "dindbos-release-manifest.json"), "utf8"));
  const signature = JSON.parse(await readFile(join(outDir, "dindbos-release-manifest.sig.json"), "utf8"));
  const verification = JSON.parse(await readFile(join(outDir, "dindbos-release-verification.json"), "utf8"));
  const sums = await readFile(join(outDir, "SHA256SUMS"), "utf8");

  assert(conformance.summary.total >= 13, "conformance category count too small");
  assert(conformance.evidenceSummary.pass >= 1, "release conformance evidence was not attached");
  assert(secureBoot.ok === true, "secure boot artifact is not ok");
  assert(secureBoot.summary.measurementCount >= 5, "secure boot measurement count too small");
  assert(manifest.source.sourceDigest.sha256.length === 64, "source aggregate digest missing");
  assert(manifest.artifacts.some((artifact) => artifact.file === "dindbos-conformance.json"), "manifest missing conformance artifact record");
  assert(manifest.artifacts.every((artifact) => artifact.sha256.length === 64 && artifact.bytes > 0), "manifest artifact digest record incomplete");
  assert(signature.algorithm === "ed25519", "release manifest signature is not ed25519");
  assert(signature.manifest.sha256.length === 64, "release manifest signature missing manifest digest");
  assert(verification.ok === true, "release signature verification artifact is not ok");
  assert(verification.keyId === signature.keyId, "release verification key id mismatch");
  assert(result.verification.ok === true, "release artifact builder did not verify the signature");
  const verified = await verifyReleaseManifestSignature({ outDir });
  assert(verified.ok === true, "release manifest verifier failed");
  assert(sums.includes("dindbos-release-manifest.json"), "sha256 sums missing release manifest");
  assert(sums.includes("dindbos-release-manifest.sig.json"), "sha256 sums missing release manifest signature");
  assert(sums.includes("dindbos-release-verification.json"), "sha256 sums missing release verification artifact");
  await assertDigestLine(outDir, sums, "dindbos-conformance.json");
  await assertDigestLine(outDir, sums, "dindbos-secure-boot.json");
  await assertDigestLine(outDir, sums, "dindbos-release-manifest.sig.json");

  manifest.source.package = "tampered-release";
  await writeFile(join(outDir, "dindbos-release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await assertRejects(() => verifyReleaseManifestSignature({ outDir }), "release verifier accepted a tampered manifest");

  console.log(`release conformance smoke ok files=${result.files.length}`);
} finally {
  await rm(outDir, { recursive: true, force: true });
}

async function assertDigestLine(targetDir, sums, file) {
  const content = await readFile(join(targetDir, file));
  const digest = createHash("sha256").update(content).digest("hex");
  assert(sums.includes(`${digest}  ${file}`), `sha256 sums digest mismatch for ${file}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertRejects(callback, message) {
  try {
    await callback();
  } catch {
    return;
  }
  throw new Error(message);
}
