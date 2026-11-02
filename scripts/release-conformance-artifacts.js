#!/usr/bin/env node
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signPayload,
  verify as verifyPayload,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DindbOS, BOOT_PHASES } from "../src/dindbos/index.js";
import { installBuiltinApps } from "../src/dindbos/apps/builtins.js";
import { demoFileSystem, portfolioData } from "../src/demo/portfolio-demo.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT_DIR = "dist/release-conformance";
const BUILD_INPUT_ROOTS = ["package.json", "package-lock.json", "vite.config.js", "index.html", "public", "src"];
const RELEASE_EVIDENCE_MATRIX_FILE = "dindbos-release-evidence-matrix.json";
const DEPLOYMENT_RECIPES_FILE = "dindbos-deployment-recipes.json";
const NPM_RELEASE_TRUST_FILE = "dindbos-npm-release-trust.json";
const RELEASE_MANIFEST_FILE = "dindbos-release-manifest.json";
const RELEASE_SIGNATURE_FILE = "dindbos-release-manifest.sig.json";
const RELEASE_VERIFICATION_FILE = "dindbos-release-verification.json";
const RELEASE_SIGNATURE_PAYLOAD = "dindbos-release-manifest-v1";

export async function buildReleaseConformanceArtifacts(options = {}) {
  const repoRoot = resolve(options.repoRoot || REPO_ROOT);
  const outDir = resolve(repoRoot, options.outDir || DEFAULT_OUTPUT_DIR);
  const generatedAt = new Date().toISOString();
  const restoreGlobals = installDomShim();
  try {
    const os = await bootRuntime();
    const preEvidenceReport = os.conformanceReport();
    const releaseEvidenceArtifacts = [
      "dindbos-conformance.json",
      "dindbos-conformance-evidence.json",
      "dindbos-secure-boot.json",
      DEPLOYMENT_RECIPES_FILE,
      NPM_RELEASE_TRUST_FILE,
      RELEASE_EVIDENCE_MATRIX_FILE,
    ];
    os.addConformanceEvidence({
      id: options.evidenceId || "release-conformance-snapshot",
      profile: options.evidenceProfile || "chromium-tab",
      status: "pass",
      runner: options.evidenceRunner || "release-conformance-artifacts",
      recordedAt: generatedAt,
      categories: preEvidenceReport.categories.map((category) => category.id),
      artifacts: releaseEvidenceArtifacts,
      notes: "Generated from a headless DindbOS boot during release artifact creation.",
    });
    const isolation = os.isolationStatus();
    os.addConformanceEvidence({
      id: options.isolationEvidenceId || "release-origin-isolation-qa",
      profile: "cross-origin-isolated",
      status: isolation.sharedMemory?.available ? "pass" : "degraded",
      runner: options.evidenceRunner || "release-conformance-artifacts",
      recordedAt: generatedAt,
      categories: ["cross-origin-isolation", "worker-isolation", "wasm"],
      artifacts: releaseEvidenceArtifacts,
      notes: isolation.sharedMemory?.available
        ? "Release runtime had crossOriginIsolated=true and SharedArrayBuffer/Atomics available."
        : `Release runtime is not origin-isolated yet: ${(isolation.degradedModes || []).join("; ") || "unknown"}.`,
    });

    const conformance = os.writeConformanceProcfs("release-artifact");
    const secureBoot = os.writeSecureBootProcfs("release-artifact");
    const evidence = JSON.parse(os.fs.readFile("/proc/conformance-evidence.json"));
    const deploymentRecipes = createDeploymentRecipes({ generatedAt });
    const sourceDigest = await sourceTreeDigest(repoRoot);
    const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    await mkdir(outDir, { recursive: true });
    const npmReleaseTrust = await createNpmReleaseTrust({ repoRoot, outDir, generatedAt, packageJson });
    const releaseEvidenceMatrix = createReleaseEvidenceMatrix({ generatedAt, conformance, evidence, isolation, secureBoot, deploymentRecipes, npmReleaseTrust });

    const baseArtifacts = [
      jsonArtifact("dindbos-conformance.json", conformance, "application/json"),
      jsonArtifact("dindbos-conformance-evidence.json", evidence, "application/json"),
      jsonArtifact("dindbos-secure-boot.json", secureBoot, "application/json"),
      jsonArtifact(DEPLOYMENT_RECIPES_FILE, deploymentRecipes, "application/vnd.dindbos.deployment-recipes+json"),
      jsonArtifact(NPM_RELEASE_TRUST_FILE, npmReleaseTrust, "application/vnd.dindbos.npm-release-trust+json"),
      jsonArtifact(RELEASE_EVIDENCE_MATRIX_FILE, releaseEvidenceMatrix, "application/vnd.dindbos.release-evidence-matrix+json"),
    ];
    const manifest = {
      service: "dindbos-release-conformance",
      version: 1,
      generatedAt,
      source: {
        package: packageJson.name || "dindbos",
        version: packageJson.version || "0.0.0",
        gitCommit: gitValue(repoRoot, ["rev-parse", "HEAD"]),
        gitDirty: gitValue(repoRoot, ["status", "--short"]) !== "",
        sourceDigest,
      },
      runtime: conformance.runtime,
      boot: {
        phases: BOOT_PHASES.map((phase) => phase.id),
        lifecycle: os.lifecycleStatus(),
      },
      conformance: {
        summary: conformance.summary,
        evidenceSummary: conformance.evidenceSummary,
        categories: conformance.categories.map((category) => ({ id: category.id, level: category.level })),
        browserMatrix: conformance.browserMatrix.map((entry) => ({
          profile: entry.profile,
          level: entry.level,
          evidenceStatus: entry.evidenceStatus,
          evidenceCount: entry.evidenceCount,
        })),
      },
      secureBoot: {
        ok: secureBoot.ok,
        profile: secureBoot.profile,
        algorithm: secureBoot.algorithm,
        summary: secureBoot.summary,
      },
      deployment: {
        recipes: deploymentRecipes.recipes.map((recipe) => ({
          id: recipe.id,
          status: recipe.expected.crossOriginIsolated ? "origin-isolated" : "degraded",
          crossOriginIsolated: recipe.expected.crossOriginIsolated,
        })),
      },
      npm: {
        package: npmReleaseTrust.packageMetadata.name,
        version: npmReleaseTrust.packageMetadata.version,
        tarball: {
          filename: npmReleaseTrust.tarball.filename,
          sha256: npmReleaseTrust.tarball.sha256,
          bytes: npmReleaseTrust.tarball.bytes,
        },
        provenance: npmReleaseTrust.provenance,
        contentAllowlist: npmReleaseTrust.contentAllowlist.status,
      },
      artifacts: baseArtifacts.map((artifact) => artifact.record),
    };
    const releaseManifest = jsonArtifact(RELEASE_MANIFEST_FILE, manifest, "application/json");
    const artifacts = [...baseArtifacts, releaseManifest];
    for (const artifact of artifacts) {
      await writeFile(join(outDir, artifact.record.file), artifact.content, "utf8");
    }
    const signingKey = resolveReleaseSigningKey(options);
    const signatureArtifact = jsonArtifact(
      RELEASE_SIGNATURE_FILE,
      createReleaseManifestSignature(releaseManifest, generatedAt, signingKey),
      "application/vnd.dindbos.release-signature+json",
    );
    await writeFile(join(outDir, signatureArtifact.record.file), signatureArtifact.content, "utf8");

    const verification = await verifyReleaseManifestSignature({ outDir, verifiedAt: generatedAt });
    const verificationArtifact = jsonArtifact(
      RELEASE_VERIFICATION_FILE,
      verification,
      "application/vnd.dindbos.release-verification+json",
    );
    await writeFile(join(outDir, verificationArtifact.record.file), verificationArtifact.content, "utf8");

    const outputArtifacts = [...artifacts, signatureArtifact, verificationArtifact];
    const sums = outputArtifacts
      .map((artifact) => `${artifact.record.sha256}  ${artifact.record.file}`)
      .join("\n") + "\n";
    await writeFile(join(outDir, "SHA256SUMS"), sums, "utf8");
    return {
      outDir,
      files: [...outputArtifacts.map((artifact) => artifact.record.file), "SHA256SUMS"],
      manifest,
      releaseEvidenceMatrix,
      deploymentRecipes,
      npmReleaseTrust,
      signature: JSON.parse(signatureArtifact.content),
      verification,
      sha256Sums: sums,
    };
  } finally {
    restoreGlobals();
  }
}

export async function verifyReleaseManifestSignature(options = {}) {
  const outDir = resolve(options.outDir || join(REPO_ROOT, DEFAULT_OUTPUT_DIR));
  const manifestContent = await readFile(join(outDir, RELEASE_MANIFEST_FILE), "utf8");
  const signature = JSON.parse(await readFile(join(outDir, RELEASE_SIGNATURE_FILE), "utf8"));
  const manifestSha256 = sha256(manifestContent);
  const expectedSha256 = signature.manifest?.sha256;
  if (signature.service !== "dindbos-release-signature") {
    throw new Error(`unsupported release signature service: ${signature.service || "missing"}`);
  }
  if (signature.algorithm !== "ed25519") {
    throw new Error(`unsupported release signature algorithm: ${signature.algorithm || "missing"}`);
  }
  if (signature.file !== RELEASE_MANIFEST_FILE) {
    throw new Error(`release signature file mismatch: ${signature.file || "missing"}`);
  }
  if (expectedSha256 !== manifestSha256) {
    throw new Error("release manifest digest does not match signature metadata");
  }
  const payload = releaseManifestSigningPayload(manifestContent, manifestSha256);
  const publicKey = createPublicKey(signature.publicKeyPem);
  const verified = verifyPayload(null, payload, publicKey, fromBase64UrlSignature(signature.signature));
  if (!verified) throw new Error("release manifest signature verification failed");
  return {
    service: "dindbos-release-verification",
    version: 1,
    verifiedAt: options.verifiedAt || new Date().toISOString(),
    ok: true,
    algorithm: signature.algorithm,
    keyId: signature.keyId,
    file: RELEASE_MANIFEST_FILE,
    signatureFile: RELEASE_SIGNATURE_FILE,
    manifest: {
      sha256: manifestSha256,
      bytes: Buffer.byteLength(manifestContent),
    },
  };
}

async function bootRuntime() {
  const os = new DindbOS({
    root: createElement("release-root"),
    fileSystem: demoFileSystem,
    storage: createStorage(),
    persistDelayMs: 0,
  });
  await os.loadPersistentFileSystem();
  await os.runBootPhase("package-registry-load", () => os.packages.bootstrap());
  await os.runBootPhase("app-registry-load", () => installBuiltinApps(os, { portfolioData }));
  os.boot();
  return os;
}

function jsonArtifact(file, value, mediaType) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  return {
    content,
    record: {
      file,
      mediaType,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content),
    },
  };
}

function createReleaseEvidenceMatrix({ generatedAt, conformance, evidence, isolation, secureBoot, deploymentRecipes, npmReleaseTrust }) {
  const evidenceRecords = Array.isArray(evidence.records) ? evidence.records : [];
  const originRow = (conformance.browserMatrix || []).find((entry) => entry.profile === "cross-origin-isolated") || {};
  const currentRow = (conformance.browserMatrix || []).find((entry) => entry.profile === "chromium-tab") || {};
  return {
    service: "dindbos-release-evidence-matrix",
    version: 1,
    generatedAt,
    releaseGate: {
      status: secureBoot.ok && conformance.summary?.unsupported === undefined ? "pass" : "degraded",
      secureBoot: secureBoot.ok ? "pass" : "fail",
      browserEvidenceProfiles: evidenceRecords.length,
    },
    browserMatrix: (conformance.browserMatrix || []).map((entry) => ({
      profile: entry.profile,
      level: entry.level,
      evidenceCount: entry.evidenceCount,
      evidenceStatus: entry.evidenceStatus,
      lastEvidenceAt: entry.lastEvidenceAt,
      lastRunner: entry.lastRunner,
      notes: entry.notes,
    })),
    originIsolation: {
      profile: "cross-origin-isolated",
      level: originRow.level || "degraded",
      evidenceStatus: originRow.evidenceStatus || "unverified",
      evidenceCount: originRow.evidenceCount || 0,
      current: isolation.current,
      crossOriginIsolated: Boolean(isolation.crossOriginIsolated),
      sharedMemory: {
        status: isolation.sharedMemory?.status || "unknown",
        available: Boolean(isolation.sharedMemory?.available),
        sharedArrayBuffer: Boolean(isolation.sharedMemory?.sharedArrayBuffer),
        atomics: Boolean(isolation.sharedMemory?.atomics),
        decision: isolation.sharedMemory?.decision || "unknown",
      },
      requiredHeaders: isolation.deployment?.requiredHeaders || {},
      degradedModes: isolation.degradedModes || [],
      checks: [
        {
          id: "coop-header-declared",
          status: isolation.deployment?.requiredHeaders?.["Cross-Origin-Opener-Policy"] === "same-origin" ? "pass" : "fail",
          expected: "Cross-Origin-Opener-Policy: same-origin",
        },
        {
          id: "coep-header-declared",
          status: isolation.deployment?.requiredHeaders?.["Cross-Origin-Embedder-Policy"] ? "pass" : "fail",
          expected: "Cross-Origin-Embedder-Policy: require-corp or credentialless",
        },
        {
          id: "corp-policy-declared",
          status: isolation.deployment?.requiredHeaders?.["Cross-Origin-Resource-Policy"] ? "pass" : "fail",
          expected: "Cross-Origin-Resource-Policy for release assets",
        },
        {
          id: "shared-memory-runtime",
          status: isolation.sharedMemory?.available ? "pass" : "degraded",
          expected: "crossOriginIsolated=true with SharedArrayBuffer and Atomics",
        },
        {
          id: "worker-memory-transfer",
          status: isolation.workerMemory?.status === "shared" ? "pass" : "degraded",
          expected: "SharedArrayBuffer worker transfer when deployment is origin-isolated",
          actual: isolation.workerMemory?.transfer || "unknown",
        },
      ],
    },
    currentProfile: {
      profile: currentRow.profile || "chromium-tab",
      level: currentRow.level || "supported",
      evidenceStatus: currentRow.evidenceStatus || "unverified",
      evidenceCount: currentRow.evidenceCount || 0,
    },
    deploymentRecipes: deploymentRecipes.recipes.map((recipe) => ({
      id: recipe.id,
      label: recipe.label,
      status: recipe.expected.crossOriginIsolated ? "origin-isolated" : "degraded",
      crossOriginIsolated: recipe.expected.crossOriginIsolated,
      config: recipe.config,
    })),
    npmReleaseTrust: {
      status: npmReleaseTrust.contentAllowlist.status === "pass" && npmReleaseTrust.requiredFiles.missing.length === 0 ? "pass" : "fail",
      tarballSha256: npmReleaseTrust.tarball.sha256,
      fileCount: npmReleaseTrust.tarball.fileCount,
      packageSize: npmReleaseTrust.tarball.bytes,
      provenance: npmReleaseTrust.provenance.status,
      changelog: npmReleaseTrust.changelog.hasUnreleased ? "present" : "missing",
    },
    evidenceRecords,
  };
}

async function createNpmReleaseTrust({ repoRoot, outDir, generatedAt, packageJson }) {
  execFileSync("npm", ["run", "build:sdk"], { cwd: repoRoot, stdio: "inherit" });
  const pack = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", outDir], { cwd: repoRoot, encoding: "utf8" }))[0];
  const tarballPath = join(outDir, pack.filename);
  const tarball = await readFile(tarballPath);
  await rm(tarballPath, { force: true });
  const files = pack.files.map((entry) => ({
    path: entry.path,
    size: entry.size,
    mode: entry.mode,
  }));
  const violations = files
    .map((entry) => entry.path)
    .filter((path) => !isAllowedNpmPackageFile(path));
  const required = [
    "package.json",
    "README.md",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/styles.css",
    "dist/create.js",
    "dist/create-template/package.json",
  ];
  const fileSet = new Set(files.map((entry) => entry.path));
  const changelog = await readFile(join(repoRoot, "docs/changelog.md"), "utf8").catch(() => "");
  return {
    service: "dindbos-npm-release-trust",
    version: 1,
    generatedAt,
    packageMetadata: {
      name: packageJson.name,
      version: packageJson.version,
      private: packageJson.private,
      license: packageJson.license,
      repository: packageJson.repository || null,
      bugs: packageJson.bugs || null,
      homepage: packageJson.homepage || "",
      exports: Object.keys(packageJson.exports || {}),
      bin: packageJson.bin || {},
    },
    tarball: {
      filename: pack.filename,
      sha256: sha256(tarball),
      bytes: tarball.length,
      unpackedSize: pack.unpackedSize,
      fileCount: files.length,
      files,
    },
    contentAllowlist: {
      status: violations.length ? "fail" : "pass",
      allowed: ["package.json", "README.md", "README-ko.md", "LICENSE", "INSTALL.md", "CONTRIBUTING.md", "docs/agent-guide.md", "docs/customization.md", "docs/react-apps.md", "docs/first-app.md", "docs/builtin-apps.md", "docs/assets/**", "dist/**"],
      violations,
    },
    requiredFiles: {
      expected: required,
      missing: required.filter((file) => !fileSet.has(file)),
    },
    provenance: {
      status: "manual-required",
      command: "npm publish --provenance",
      checklist: [
        "publish from trusted CI or a clean local release environment",
        "confirm npm provenance support for the target registry",
        "record the published package URL and registry integrity digest",
      ],
    },
    changelog: {
      file: "docs/changelog.md",
      hasUnreleased: changelog.includes("## Unreleased"),
      hasReleaseChecklist: changelog.includes("Release checklist before tagging"),
    },
  };
}

function isAllowedNpmPackageFile(path) {
  return ["package.json", "README.md", "README-ko.md", "LICENSE", "INSTALL.md", "CONTRIBUTING.md", "docs/agent-guide.md", "docs/customization.md", "docs/react-apps.md", "docs/first-app.md", "docs/builtin-apps.md"].includes(path) || path.startsWith("docs/assets/") || path.startsWith("dist/");
}

function createDeploymentRecipes({ generatedAt }) {
  const originHeaders = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  return {
    service: "dindbos-deployment-recipes",
    version: 1,
    generatedAt,
    recipes: [
      {
        id: "netlify-static",
        label: "Netlify static deployment",
        config: "examples/deployment/netlify.toml",
        expected: { crossOriginIsolated: true, mode: "origin-isolated" },
        requiredHeaders: originHeaders,
        verification: ["doctor isolation", "cat /proc/isolation.json"],
      },
      {
        id: "static-server-origin-isolated",
        label: "Static server with explicit COOP/COEP/CORP headers",
        config: "examples/deployment/static-headers.txt",
        expected: { crossOriginIsolated: true, mode: "origin-isolated" },
        requiredHeaders: originHeaders,
        verification: ["doctor isolation", "cat /proc/isolation.json"],
      },
      {
        id: "github-pages",
        label: "GitHub Pages degraded deployment",
        config: "examples/deployment/github-pages.md",
        expected: { crossOriginIsolated: false, mode: "degraded" },
        requiredHeaders: {},
        verification: ["doctor isolation", "cat /proc/isolation.json"],
        notes: "Repository pages cannot attach COOP/COEP/CORP headers to every route.",
      },
      {
        id: "local-dev-default",
        label: "Default local dev server",
        config: "examples/deployment/local-dev.md",
        expected: { crossOriginIsolated: false, mode: "degraded" },
        requiredHeaders: {},
        verification: ["doctor isolation", "cat /proc/isolation.json"],
        notes: "Use custom middleware or a reverse proxy for local origin-isolated testing.",
      },
    ],
  };
}

function resolveReleaseSigningKey(options) {
  const privateKeyPem = options.signingPrivateKeyPem || process.env.DINDBOS_RELEASE_SIGNING_KEY_PEM;
  if (privateKeyPem) {
    const privateKey = createPrivateKey(privateKeyPem);
    const publicKey = createPublicKey(privateKey);
    return {
      privateKey,
      publicKey,
      source: "provided",
    };
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKey,
    source: "ephemeral",
  };
}

function createReleaseManifestSignature(releaseManifest, signedAt, signingKey) {
  const publicKeyPem = signingKey.publicKey.export({ type: "spki", format: "pem" });
  const payload = releaseManifestSigningPayload(releaseManifest.content, releaseManifest.record.sha256);
  const signature = signPayload(null, payload, signingKey.privateKey);
  return {
    service: "dindbos-release-signature",
    version: 1,
    payload: RELEASE_SIGNATURE_PAYLOAD,
    file: RELEASE_MANIFEST_FILE,
    algorithm: "ed25519",
    keyId: `ed25519-spki-sha256:${sha256(publicKeyPem).slice(0, 32)}`,
    keySource: signingKey.source,
    publicKeyPem,
    signature: `ed25519-sig:v1:${signature.toString("base64url")}`,
    signedAt,
    manifest: {
      sha256: releaseManifest.record.sha256,
      bytes: releaseManifest.record.bytes,
    },
  };
}

function releaseManifestSigningPayload(manifestContent, manifestSha256) {
  return Buffer.from(`${RELEASE_SIGNATURE_PAYLOAD}\nsha256:${manifestSha256}\n${manifestContent}`, "utf8");
}

async function sourceTreeDigest(repoRoot) {
  const files = [];
  for (const root of BUILD_INPUT_ROOTS) {
    await collectBuildInputs(repoRoot, join(repoRoot, root), files);
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const aggregate = files.map((file) => `${file.path}\0${file.sha256}\0${file.bytes}`).join("\n");
  return {
    algorithm: "sha256",
    sha256: sha256(aggregate),
    files,
  };
}

async function collectBuildInputs(repoRoot, target, files) {
  let info;
  try {
    info = await stat(target);
  } catch {
    return;
  }
  if (info.isDirectory()) {
    const entries = await readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      await collectBuildInputs(repoRoot, join(target, entry.name), files);
    }
    return;
  }
  if (!info.isFile()) return;
  const bytes = await readFile(target);
  files.push({
    path: relative(repoRoot, target),
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}

function gitValue(repoRoot, args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fromBase64UrlSignature(value) {
  const prefix = "ed25519-sig:v1:";
  if (!String(value).startsWith(prefix)) throw new Error("release signature has invalid encoding prefix");
  return Buffer.from(String(value).slice(prefix.length), "base64url");
}

function installDomShim() {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalNotification = Object.getOwnPropertyDescriptor(globalThis, "Notification");
  const originalPeerConnection = Object.getOwnPropertyDescriptor(globalThis, "RTCPeerConnection");
  const originalOpenFile = Object.getOwnPropertyDescriptor(globalThis, "showOpenFilePicker");
  const originalSaveFile = Object.getOwnPropertyDescriptor(globalThis, "showSaveFilePicker");
  const originalDirectory = Object.getOwnPropertyDescriptor(globalThis, "showDirectoryPicker");
  globalThis.document = {
    createElement: (tagName) => createElement(tagName),
    addEventListener() {},
    visibilityState: "visible",
  };
  globalThis.window = {
    addEventListener() {},
    setInterval() {
      return 1;
    },
    matchMedia: () => ({ matches: false }),
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: { readText() {}, writeText() {} },
      mediaDevices: { getDisplayMedia() {}, getUserMedia() {}, enumerateDevices() {} },
      share() {},
      gpu: {},
      usb: {},
      serial: {},
      hid: {},
    },
  });
  Object.defineProperty(globalThis, "Notification", { configurable: true, value: function Notification() {} });
  Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: function RTCPeerConnection() {} });
  Object.defineProperty(globalThis, "showOpenFilePicker", { configurable: true, value() {} });
  Object.defineProperty(globalThis, "showSaveFilePicker", { configurable: true, value() {} });
  Object.defineProperty(globalThis, "showDirectoryPicker", { configurable: true, value() {} });
  return () => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    restoreGlobalDescriptor("navigator", originalNavigator);
    restoreGlobalDescriptor("Notification", originalNotification);
    restoreGlobalDescriptor("RTCPeerConnection", originalPeerConnection);
    restoreGlobalDescriptor("showOpenFilePicker", originalOpenFile);
    restoreGlobalDescriptor("showSaveFilePicker", originalSaveFile);
    restoreGlobalDescriptor("showDirectoryPicker", originalDirectory);
  };
}

function restoreGlobalDescriptor(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

function createElement(tagName) {
  const children = [];
  const element = {
    tagName,
    children,
    dataset: {},
    style: {},
    hidden: false,
    className: "",
    textContent: "",
    _innerHTML: "",
    classList: {
      toggle() {},
      add() {},
      remove() {},
    },
    set innerHTML(value) {
      this._innerHTML = String(value);
    },
    get innerHTML() {
      return this._innerHTML;
    },
    appendChild(child) {
      children.push(child);
      return child;
    },
    append(...items) {
      items.forEach((item) => children.push(item));
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      if (!this._queries) this._queries = new Map();
      if (!this._queries.has(selector)) this._queries.set(selector, createElement(selector));
      return this._queries.get(selector);
    },
    querySelectorAll() {
      return [];
    },
  };
  return element;
}

function createStorage() {
  return {
    async loadFileSystem() {
      return null;
    },
    saveFileSystem() {},
    async flush() {},
    async readValue() {
      return null;
    },
    writeValue() {},
    status: () => ({ backend: "memory" }),
    estimate: async () => ({ backend: "memory" }),
    resetFileSystem() {},
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      options.outDir = argv[index + 1];
      index += 1;
    } else if (arg === "--profile") {
      options.evidenceProfile = argv[index + 1];
      index += 1;
    } else if (arg === "--runner") {
      options.evidenceRunner = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildReleaseConformanceArtifacts(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(`release conformance artifacts written ${result.outDir}`);
      result.files.forEach((file) => console.log(file));
    })
    .catch((error) => {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    });
}
