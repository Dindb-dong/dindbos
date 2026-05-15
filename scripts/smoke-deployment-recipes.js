#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReleaseConformanceArtifacts } from "./release-conformance-artifacts.js";

const outDir = await mkdtemp(join(tmpdir(), "dindbos-deployment-recipes-"));

try {
  const docs = await readFile("docs/deployment.md", "utf8");
  const netlify = await readFile("examples/deployment/netlify.toml", "utf8");
  const staticHeaders = await readFile("examples/deployment/static-headers.txt", "utf8");
  for (const text of [docs, netlify, staticHeaders]) {
    assert(text.includes("Cross-Origin-Opener-Policy"), "deployment recipe missing COOP");
    assert(text.includes("Cross-Origin-Embedder-Policy"), "deployment recipe missing COEP");
    assert(text.includes("Cross-Origin-Resource-Policy"), "deployment recipe missing CORP");
  }
  assert(docs.includes("GitHub Pages") && docs.includes("degraded mode"), "deployment docs missing GitHub Pages degraded guidance");
  assert(docs.includes("dindbos-deployment-recipes.json"), "deployment docs missing release evidence artifact");

  const result = await buildReleaseConformanceArtifacts({ outDir, evidenceRunner: "deployment-recipes-smoke" });
  assert(result.files.includes("dindbos-deployment-recipes.json"), "deployment recipes artifact missing");
  const recipes = JSON.parse(await readFile(join(outDir, "dindbos-deployment-recipes.json"), "utf8"));
  const matrix = JSON.parse(await readFile(join(outDir, "dindbos-release-evidence-matrix.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(outDir, "dindbos-release-manifest.json"), "utf8"));

  assert(recipes.recipes.some((recipe) => recipe.id === "netlify-static" && recipe.expected.crossOriginIsolated === true), "Netlify origin-isolated recipe missing");
  assert(recipes.recipes.some((recipe) => recipe.id === "github-pages" && recipe.expected.crossOriginIsolated === false), "GitHub Pages degraded recipe missing");
  assert(matrix.deploymentRecipes.some((recipe) => recipe.id === "static-server-origin-isolated"), "release matrix missing static server recipe");
  assert(manifest.deployment.recipes.some((recipe) => recipe.id === "local-dev-default" && recipe.status === "degraded"), "release manifest missing local dev degraded recipe");

  console.log(`deployment recipes smoke ok recipes=${recipes.recipes.length}`);
} finally {
  await rm(outDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
