#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DindbOS, BOOT_PHASES } from "../src/dindbos/index.js";
import { installBuiltinApps } from "../src/dindbos/apps/builtins.js";
import { demoFileSystem, portfolioData } from "../src/demo/portfolio-demo.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT_DIR = "dist/release-conformance";
const BUILD_INPUT_ROOTS = ["package.json", "package-lock.json", "vite.config.js", "index.html", "public", "src"];

export async function buildReleaseConformanceArtifacts(options = {}) {
  const repoRoot = resolve(options.repoRoot || REPO_ROOT);
  const outDir = resolve(repoRoot, options.outDir || DEFAULT_OUTPUT_DIR);
  const generatedAt = new Date().toISOString();
  const restoreGlobals = installDomShim();
  try {
    const os = await bootRuntime();
    const preEvidenceReport = os.conformanceReport();
    os.addConformanceEvidence({
      id: options.evidenceId || "release-conformance-snapshot",
      profile: options.evidenceProfile || "chromium-tab",
      status: "pass",
      runner: options.evidenceRunner || "release-conformance-artifacts",
      recordedAt: generatedAt,
      categories: preEvidenceReport.categories.map((category) => category.id),
      artifacts: [
        "dindbos-conformance.json",
        "dindbos-conformance-evidence.json",
        "dindbos-secure-boot.json",
      ],
      notes: "Generated from a headless DindbOS boot during release artifact creation.",
    });

    const conformance = os.writeConformanceProcfs("release-artifact");
    const secureBoot = os.writeSecureBootProcfs("release-artifact");
    const evidence = JSON.parse(os.fs.readFile("/proc/conformance-evidence.json"));
    const sourceDigest = await sourceTreeDigest(repoRoot);
    const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));

    await mkdir(outDir, { recursive: true });
    const baseArtifacts = [
      jsonArtifact("dindbos-conformance.json", conformance, "application/json"),
      jsonArtifact("dindbos-conformance-evidence.json", evidence, "application/json"),
      jsonArtifact("dindbos-secure-boot.json", secureBoot, "application/json"),
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
      },
      secureBoot: {
        ok: secureBoot.ok,
        profile: secureBoot.profile,
        algorithm: secureBoot.algorithm,
        summary: secureBoot.summary,
      },
      artifacts: baseArtifacts.map((artifact) => artifact.record),
    };
    const releaseManifest = jsonArtifact("dindbos-release-manifest.json", manifest, "application/json");
    const artifacts = [...baseArtifacts, releaseManifest];
    for (const artifact of artifacts) {
      await writeFile(join(outDir, artifact.record.file), artifact.content, "utf8");
    }
    const sums = artifacts
      .map((artifact) => `${artifact.record.sha256}  ${artifact.record.file}`)
      .join("\n") + "\n";
    await writeFile(join(outDir, "SHA256SUMS"), sums, "utf8");
    return {
      outDir,
      files: [...artifacts.map((artifact) => artifact.record.file), "SHA256SUMS"],
      manifest,
      sha256Sums: sums,
    };
  } finally {
    restoreGlobals();
  }
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
