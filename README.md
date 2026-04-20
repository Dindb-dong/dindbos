# DindbOS.js

DindbOS.js is a browser-native desktop runtime for portfolio sites, docs, demos, and web OS experiments.

It is not a Linux kernel emulator. It is a small OS-style runtime for the browser:

- virtual file system
- app registry
- window manager
- desktop shell
- built-in apps
- portfolio/demo mounting

The first demo boots a portfolio inside DindbOS instead of decorating a portfolio page to look like an OS.

## Demo

- GitHub Pages: https://dindb-dong.github.io/dindbos/

## Local Dev

```bash
npm run dev
```

Then open `http://127.0.0.1:5173`.

## Project Shape

```text
src/
  dindbos/       runtime modules
  demo/          portfolio demo mount
  styles/        default DindbOS theme
```

## Goal

The goal is to make DindbOS.js useful as an open-source web desktop runtime, while this repository also serves as the canonical demo.
