#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReleaseConformanceArtifacts } from "./release-conformance-artifacts.js";

const outDir = await mkdtemp(join(tmpdir(), "dindbos-npm-release-trust-"));

try {
  const result = await buildReleaseConformanceArtifacts({ outDir, evidenceRunner: "npm-release-trust-smoke" });
  assert(result.files.includes("dindbos-npm-release-trust.json"), "npm release trust artifact missing");
  const trust = JSON.parse(await readFile(join(outDir, "dindbos-npm-release-trust.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(outDir, "dindbos-release-manifest.json"), "utf8"));
  const matrix = JSON.parse(await readFile(join(outDir, "dindbos-release-evidence-matrix.json"), "utf8"));

  assert(trust.tarball.sha256.length === 64, "npm tarball sha256 missing");
  assert(trust.packageMetadata.private === false, "package must be public");
  assert(trust.packageMetadata.repository.url.includes("github.com/Dindb-dong/dindbos"), "repository metadata missing");
  assert(trust.contentAllowlist.status === "pass", `package content allowlist failed: ${trust.contentAllowlist.violations.join(", ")}`);
  assert(trust.requiredFiles.missing.length === 0, `package required files missing: ${trust.requiredFiles.missing.join(", ")}`);
  assert(trust.provenance.command === "npm publish --provenance", "npm provenance command missing");
  assert(trust.changelog.hasUnreleased === true, "changelog unreleased notes missing");
  assert(manifest.npm.tarball.sha256 === trust.tarball.sha256, "manifest npm tarball digest mismatch");
  assert(matrix.npmReleaseTrust.status === "pass", "release matrix npm trust did not pass");

  console.log(`npm release trust smoke ok files=${trust.tarball.fileCount} size=${trust.tarball.bytes}`);
} finally {
  await rm(outDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
