# DindbOS Embeddable SDK Plan

DindbOS should be installable as a browser OS runtime, not only runnable as this repository's demo app.

Target install path:

```bash
npm install dindbos
```

Target host app usage:

```js
import { createDindbOS, installBuiltinApps } from "dindbos";
import "dindbos/styles.css";

const os = await createDindbOS({
  root: "#app",
  session: { user: "guest", product: "DindbOS.js" },
  fileSystem: {
    "/home/guest/readme.md": "# Hello from DindbOS\n",
  },
});

await installBuiltinApps(os);
await os.boot();
```

This document defines the work needed to make that promise real.

## Product Goal

Let another web project embed DindbOS as a real runtime layer:

- The host app owns its page shell, route, build tool, and deployment.
- DindbOS owns the runtime primitive: VFS, processes, packages, permissions, browser brokers, windows, shell, diagnostics, and conformance.
- The host can seed files, register apps, choose storage/service-worker behavior, and expose or hide built-in apps.
- Browser constraints remain explicit through conformance and isolation diagnostics.

Non-goals:

- Do not make `import "dindbos"` auto-boot anything.
- Do not require the host app to use the demo portfolio data.
- Do not force React unless the host chooses the React wrapper.
- Do not hide required COOP/COEP/CORP headers for origin-isolated deployments.

## Real User Readiness Bar

This project is not ready for npm publication just because the package can be imported. It is ready only when a person who did not read this repository can install it, boot it, debug it, deploy it, and upgrade it without asking the maintainer for hidden steps.

The npm package must satisfy these product-level goals:

- Install works in a clean project with `npm install dindbos`.
- TypeScript and plain JavaScript users both get good editor feedback.
- Vite, Next.js, Astro, and plain static hosts have documented integration paths.
- A new host app can boot DindbOS with less than 20 lines of code.
- The default UI is usable without copying internal CSS from the repository.
- Built-in apps can be installed all at once, individually, or not at all.
- The host can register its own GUI apps, shell commands, package registry entries, and initial files.
- The host can choose memory-only, IndexedDB/OPFS-backed, or custom storage.
- Browser/device features are permissioned through DindbOS brokers, not raw host globals.
- Service Worker and origin-isolated deployment requirements are documented with copyable headers.
- The package exposes conformance diagnostics so host projects can prove what is supported in their deployment.
- The package ships without demo portfolio data unless the host explicitly imports an example package.
- The package can be upgraded across minor versions with a changelog and migration notes.
- Release artifacts prove the npm tarball, exports, types, bundle size, conformance, and signature verification.

## Supported Host Matrix

First-class support:

- Vite vanilla app.
- Vite React app.
- Static HTML/ESM app.
- Netlify static deployment with optional COOP/COEP/CORP headers.
- GitHub Pages or similar static deployment in degraded non-origin-isolated mode.

Documented support:

- Next.js client-only component usage.
- Astro island/client-only usage.
- Existing apps that mount DindbOS inside a route or panel instead of owning the whole page.

Explicitly unsupported in v1:

- Server-side rendering the live OS runtime.
- Running DindbOS in Node.js as a real host OS.
- Native filesystem access without browser picker grants or a companion.
- Hidden privileged browser access outside declared brokers.

Each supported host must have at least one install smoke. The smoke should install the packed tarball, import from package exports, boot the runtime, write a file, launch Terminal/Files, and read `/proc/conformance.json`.

## Package Shape

`package.json` should expose stable entrypoints:

```json
{
  "name": "dindbos",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./desktop": {
      "types": "./dist/desktop.d.ts",
      "import": "./dist/desktop.js"
    },
    "./builtins": {
      "types": "./dist/builtins.d.ts",
      "import": "./dist/builtins.js"
    },
    "./testing": {
      "types": "./dist/testing.d.ts",
      "import": "./dist/testing.js"
    },
    "./react": {
      "types": "./dist/react.d.ts",
      "import": "./dist/react.js"
    },
    "./create": {
      "types": "./dist/create.d.ts",
      "import": "./dist/create.js"
    },
    "./styles.css": "./dist/styles.css"
  },
  "files": ["dist", "README.md", "LICENSE"]
}
```

Primary entrypoints:

- `dindbos`: core runtime constructors, app/package APIs, conformance helpers.
- `dindbos/desktop`: desktop shell mount helpers and optional boot screen.
- `dindbos/builtins`: Files, Terminal, Settings, Viewer, Browser, Activity Monitor, TextEdit, and demo-free built-in registration.
- `dindbos/testing`: headless runtime helpers for package authors and host app CI.
- `dindbos/react`: optional React component wrapper. React must remain a peer/optional integration path, not a core runtime requirement.
- `dindbos/create`: programmatic project/template generator used by the CLI.
- `dindbos/styles.css`: default desktop/application styles.

## Public API

The first SDK API should stay small and hard to misuse.

```ts
export interface CreateDindbOSOptions {
  root: string | HTMLElement;
  fileSystem?: Record<string, string | Uint8Array | ArrayBuffer>;
  session?: {
    user?: string;
    product?: string;
    groups?: string[];
  };
  storage?: DindbOSStorageAdapter;
  persistDelayMs?: number;
  serviceWorker?: false | {
    enabled?: boolean;
    scope?: string;
    scriptUrl?: string;
  };
  desktop?: false | {
    bootScreen?: boolean;
    launch?: string[];
  };
}

export async function createDindbOS(options: CreateDindbOSOptions): Promise<DindbOS>;
export async function bootDindbOS(os: DindbOS, options?: BootDindbOSOptions): Promise<DindbOS>;
export function installBuiltinApps(os: DindbOS, options?: BuiltinAppOptions): Promise<void> | void;
```

Recommended boot helper behavior:

1. Construct `DindbOS`.
2. Load persistent storage.
3. Bootstrap package registry.
4. Register host-provided and built-in apps.
5. Boot the runtime.
6. Optionally register Service Worker boot.
7. Optionally launch initial apps.

The core constructor should still be exported for advanced hosts, but docs should lead with `createDindbOS` and `bootDindbOS`.

## Source Refactor

Current `src/main.js` is the demo app entrypoint. It should become a thin consumer of the SDK API.

New source layout:

```text
src/
  main.js                         demo app entrypoint
  sdk/
    index.js                      public package root
    desktop.js                    desktop/boot-screen mount helpers
    builtins.js                   built-in app registration facade
    testing.js                    headless test runtime helpers
  dindbos/                        runtime kernel modules
  ui/                             reusable desktop/boot-screen UI
  styles/dindbos.css              distributable CSS
  demo/                           portfolio demo data only
```

Important cleanup:

- Remove `?v=...` cache-busting import suffixes from library modules before publishing.
- Keep demo-only imports out of SDK entrypoints.
- Keep browser globals behind runtime capability probes.
- Ensure CSS can be imported from `dindbos/styles.css` without requiring the demo app.

## Build Plan

Use Vite library mode or Rollup with multiple inputs:

```text
dist/index.js
dist/desktop.js
dist/builtins.js
dist/testing.js
dist/react.js
dist/create.js
dist/styles.css
dist/index.d.ts
dist/desktop.d.ts
dist/builtins.d.ts
dist/testing.d.ts
dist/react.d.ts
dist/create.d.ts
```

Required scripts:

```json
{
  "scripts": {
    "build": "vite build",
    "build:sdk": "vite build --config vite.sdk.config.js",
    "pack:dry": "npm pack --dry-run",
    "smoke:sdk-pack": "node scripts/smoke-sdk-pack.js"
  }
}
```

`smoke:sdk-pack` must:

1. Run the SDK build.
2. Run `npm pack`.
3. Create a temporary Vite host app.
4. Install the generated tarball into that host app.
5. Import `createDindbOS`, `installBuiltinApps`, and `dindbos/styles.css`.
6. Boot a minimal runtime.
7. Assert `/proc/conformance.json`, `/proc/isolation.json`, Terminal, Files, and VFS writes work.

Additional package quality gates:

- No demo-only imports in `dist/index.js`.
- No unresolved `?v=` import suffixes in `dist`.
- No accidental `src/`, `scripts/`, screenshots, temporary files, or generated `dist/release-conformance` artifacts inside the npm tarball.
- `npm pack --json` output is parsed and checked against an allowlist.
- Package size and gzip size are recorded in release evidence.
- Source maps are either shipped intentionally or omitted intentionally; the decision must be documented.
- CSS import works in a clean host app without relying on global demo markup.

## Host Integration Contract

The host app must be able to control these surfaces without patching internals:

- `root`: where the desktop or runtime shell mounts.
- `fileSystem`: initial file seed.
- `apps`: host app manifests and render functions.
- `packages`: package registry seed and trusted publishers.
- `storage`: memory, browser-backed, or custom adapter.
- `permissions`: initial grants, denied capabilities, and policy hooks.
- `brokers`: browser/device broker availability and companion configuration.
- `serviceWorker`: disabled, auto-register, or host-managed.
- `isolation`: required headers and degraded-mode policy.
- `theme`: CSS variables or class hooks for host branding.
- `diagnostics`: conformance evidence callback and release artifact hook.

Public configuration should be declarative:

```js
const os = await createDindbOS({
  root: "#app",
  fileSystem: seedFiles,
  apps: [notesApp, adminConsoleApp],
  packages: { registry: "/packages/registry.json" },
  storage: { backend: "indexeddb", name: "my-product-os" },
  serviceWorker: { enabled: true, scriptUrl: "/dindbos-sw.js" },
  isolation: { preferOriginIsolated: true, allowDegraded: true },
});
```

## Framework Adapters

The core package stays framework-neutral. Framework adapters are thin integration helpers:

- Vanilla: `createDindbOS({ root })`.
- React: `<DindbOSProvider>` and `<DindbOSDesktop>`.
- Next.js: client-only wrapper with SSR guard and dynamic import example.
- Astro: client-only island example.

Adapters must not fork runtime behavior. They only manage mount lifecycle, cleanup, and host framework ergonomics.

React wrapper target:

```jsx
import { DindbOSDesktop } from "dindbos/react";
import "dindbos/styles.css";

export default function WebOSRoute() {
  return (
    <DindbOSDesktop
      fileSystem={{ "/home/guest/readme.md": "# Hello\n" }}
      builtins={["files", "terminal", "settings"]}
    />
  );
}
```

## Release Trust And npm Publishing

The package should publish like a serious runtime dependency:

- Use semantic versioning.
- Generate changelog entries for all public API changes.
- Publish with npm provenance when available.
- Keep `private: false`, `license`, `repository`, `bugs`, `homepage`, and `keywords` accurate.
- Ship type declarations and validate them from an external project.
- Sign release conformance artifacts.
- Record npm tarball SHA-256 in release evidence.
- Keep a documented support window for the latest minor release.
- Never publish secrets, local `.env` files, generated QA screenshots, or test-only worktrees.

Before first public release, reserve package ownership and verify install behavior from the public registry or a dry-run registry workflow.

## User-Facing Documentation

Real users need docs arranged by task, not by internal subsystem.

Required docs before npm launch:

- Quickstart: install and boot in Vite.
- React quickstart.
- Next.js client-only route guide.
- Add your first app.
- Seed files and persist storage.
- Use built-in Terminal and Files.
- Register browser broker permissions.
- Deploy with origin isolation.
- Read conformance and diagnose degraded mode.
- Package size, browser support, and known limitations.
- Upgrade guide and changelog.

Every quickstart must include a copyable command sequence and a screenshot or expected result. Every deployment guide must state whether it gets `crossOriginIsolated=true` or a degraded mode.

## CLI Plan

Add a project generator:

```bash
npx create-dindbos my-web-os
```

Generated project:

```text
my-web-os/
  package.json
  index.html
  src/main.js
  src/apps/hello.js
  dindbos.config.js
  public/dindbos-sw.js
```

Initial template behavior:

- Mount DindbOS into `#app`.
- Seed `/home/guest/readme.md`.
- Register one sample host app.
- Install default built-ins.
- Include comments for origin-isolated deployment headers.

The CLI can live in this repository first as `create-dindbos`, then become a second npm package if release cadence needs separation.

## Documentation Plan

Publish SDK-first docs:

- `README.md`: "Install DindbOS in your web app in five minutes."
- `docs/sdk-packaging.md`: this implementation plan.
- `docs/first-app.md`: update to show host app registration through SDK exports.
- `docs/isolation.md`: add Netlify/Vercel/static-server header examples.
- `docs/conformance.md`: explain how host apps can attach release evidence.

Minimum examples:

- Vanilla Vite host app.
- React host app wrapper.
- Origin-isolated static deployment.
- Custom storage adapter.
- Custom package registry seed.

## Release Gates

The package is publishable only when all gates pass:

```bash
npm run check
npm run smoke:sdk
npm run smoke:sdk-pack
npm run smoke:release-conformance
npm run build:sdk
npm pack --dry-run
```

Release evidence must include:

- SDK tarball filename and SHA-256.
- Public exports list.
- Package size summary.
- Host app smoke result.
- Conformance artifact signature verification.
- Origin-isolated deployment instructions or explicit degraded status.

## Implementation Sequence

### PR 1: Public SDK Entrypoints

- Add `src/sdk/index.js`, `src/sdk/desktop.js`, `src/sdk/builtins.js`, and `src/sdk/testing.js`.
- Move demo boot logic behind `createDindbOS` and `bootDindbOS`.
- Keep `src/main.js` as a consumer of the new API.
- Add smoke coverage for importing SDK entrypoints from source.

### PR 2: Host Configuration Contract

- Add declarative host options for files, apps, packages, storage, brokers, service worker, isolation, and diagnostics.
- Document defaults and error behavior.
- Add tests for invalid host config and safe degraded defaults.

### PR 3: Library Build And Exports

- Add SDK build config.
- Add `exports`, `files`, `types`, and `sideEffects` package metadata.
- Emit distributable JS and CSS.
- Add `npm pack --dry-run` validation.

### PR 4: Type Declarations And API Stability

- Generate or author `.d.ts` files for all public entrypoints.
- Add API snapshot tests for exported names.
- Add TypeScript host app smoke coverage.
- Mark experimental APIs explicitly.

### PR 5: Tarball Host App Smoke

- Add `scripts/smoke-sdk-pack.js`.
- Install the generated tarball into a temporary Vite app.
- Boot DindbOS from the installed package, not local source.
- Verify VFS writes, built-in apps, conformance, and CSS import.

### PR 6: Framework Examples And Adapters

- Add vanilla Vite, React, Next.js client-only, and Astro examples.
- Add `dindbos/react` wrapper.
- Verify each example imports from the packed tarball.

### PR 7: Create-DindbOS CLI

- Add a generator command and template.
- Generate a minimal working host app.
- Add smoke coverage that runs the generated app build.

### PR 8: Deployment Recipes And Isolation QA

- Add Netlify, static-server, GitHub Pages, and local dev deployment recipes.
- Add origin-isolated hosted QA path where feasible.
- Record cross-origin isolation evidence in release artifacts.

### PR 9: npm Release Trust

- Add npm tarball SHA-256 and package metadata to release conformance artifacts.
- Add changelog/release note generation.
- Add npm provenance/publish checklist.
- Add package content allowlist checks.

### PR 10: User Docs And Launch Polish

- Rewrite README around `npm install dindbos`.
- Update first-app, isolation, conformance, and package docs.
- Extend release conformance artifacts with SDK package/tarball evidence.
- Add screenshots or expected output for quickstarts.
- Add troubleshooting guide for blank mount, missing CSS, storage denial, Service Worker scope, and origin isolation.

## Done Definition

DindbOS is "npm-install embeddable" when a clean external project can run:

```bash
npm install dindbos
```

and boot a real DindbOS runtime with:

- shared VFS and persistent storage,
- Terminal and GUI built-ins,
- host app registration,
- package install/runtime policy,
- browser broker diagnostics,
- conformance and release evidence,
- no dependency on this repository's demo app,
- clean type declarations and public exports,
- documented framework integration,
- documented deployment headers,
- tarball install smoke coverage from outside the repository,
- package contents small enough and intentional enough for a real dependency,
- changelog and upgrade notes for public users.
