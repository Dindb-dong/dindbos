# DindbOS SDK Examples

These examples show DindbOS embedded inside host-owned web projects.

## Vanilla Vite

```bash
cd examples/vanilla-vite
npm install
npm run dev
```

The app imports `createAndBootDindbOS` from `dindbos`, imports `dindbos/styles.css`, seeds `/home/guest/readme.md`, and launches Files and Terminal.

## React Vite

```bash
cd examples/react-vite
npm install
npm run dev
```

The app imports `DindbOSDesktop` from `dindbos/react`. The React adapter only manages mount lifecycle and context; runtime behavior stays in the core package.

## Next.js Client Route

```bash
cd examples/next-client
npm install
npm run dev
```

The route uses `"use client"` and `next/dynamic` with `ssr: false`, because the live OS runtime needs browser DOM APIs.

## Astro Island

```bash
cd examples/astro-island
npm install
npm run dev
```

The page mounts the React adapter as a client-only island with `client:only="react"`.

## CI Smoke

`npm run smoke:sdk-frameworks` packs the SDK, installs the generated tarball into the Vite examples, builds them, and statically verifies the Next.js and Astro examples import the same public package entrypoints.
