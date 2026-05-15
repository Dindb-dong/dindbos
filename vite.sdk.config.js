import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const entrypoints = {
  index: resolve("src/sdk/index.js"),
  desktop: resolve("src/sdk/desktop.js"),
  builtins: resolve("src/sdk/builtins.js"),
  testing: resolve("src/sdk/testing.js"),
};

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "dist",
    sourcemap: true,
    lib: {
      entry: entrypoints,
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [sdkArtifactsPlugin()],
});

function sdkArtifactsPlugin() {
  return {
    name: "dindbos-sdk-artifacts",
    closeBundle() {
      mkdirSync("dist", { recursive: true });
      copyFileSync("src/styles/dindbos.css", "dist/styles.css");
      for (const name of Object.keys(entrypoints)) {
        writeFileSync(`dist/${name}.d.ts`, declarationFor(name), "utf8");
      }
    },
  };
}

function declarationFor(name) {
  if (name === "index") {
    return [
      "export class DindbOS { constructor(options?: Record<string, unknown>); }",
      "export const BOOT_PHASES: Array<{ id: string; label: string }>;",
      "export function createDindbOS(options?: Record<string, unknown>): Promise<DindbOS>;",
      "export function bootDindbOS(os: DindbOS, options?: Record<string, unknown>): Promise<DindbOS>;",
      "export function createAndBootDindbOS(options?: Record<string, unknown>): Promise<DindbOS>;",
      "export function prepareDindbOSHost(os: DindbOS, options?: Record<string, unknown>): Promise<DindbOS>;",
      "export function normalizeDindbOSHostConfig(options?: Record<string, unknown>): Record<string, unknown>;",
      "export function publicHostConfig(config?: Record<string, unknown>): Record<string, unknown>;",
      "export function applyDindbOSHostConfig(os: DindbOS, config?: Record<string, unknown>): Promise<DindbOS>;",
      "export function installDindbOSBuiltins(os: DindbOS, options?: Record<string, unknown>): unknown;",
      "export function installBuiltinApps(os: DindbOS, options?: Record<string, unknown>): unknown;",
      "export function compatibilitySnapshot(runtime?: Record<string, unknown>): Record<string, unknown>;",
      "export function conformanceReport(runtime?: Record<string, unknown>): Record<string, unknown>;",
      "export function isolationSnapshot(browser?: Record<string, unknown>): Record<string, unknown>;",
      "",
    ].join("\n");
  }
  if (name === "desktop") {
    return [
      "import type { DindbOS } from \"./index.js\";",
      "export function mountBootScreen(options?: Record<string, unknown>): Record<string, unknown>;",
      "export function mountDindbOSDesktop(options?: Record<string, unknown>): Promise<DindbOS>;",
      "export function createDindbOS(options?: Record<string, unknown>): Promise<DindbOS>;",
      "export function bootDindbOS(os: DindbOS, options?: Record<string, unknown>): Promise<DindbOS>;",
      "export function createAndBootDindbOS(options?: Record<string, unknown>): Promise<DindbOS>;",
      "",
    ].join("\n");
  }
  if (name === "builtins") {
    return [
      "import type { DindbOS } from \"./index.js\";",
      "export const BROWSER_LOCAL_HTML_SANDBOX: string;",
      "export function installBuiltinApps(os: DindbOS, options?: Record<string, unknown>): unknown;",
      "export function installDindbOSBuiltins(os: DindbOS, options?: Record<string, unknown>): unknown;",
      "",
    ].join("\n");
  }
  return [
    "import type { DindbOS } from \"./index.js\";",
    "export function createHeadlessDindbOS(options?: Record<string, unknown>): Promise<DindbOS>;",
    "export function createBootedTestDindbOS(options?: Record<string, unknown>): Promise<DindbOS>;",
    "",
  ].join("\n");
}
