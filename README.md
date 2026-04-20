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

Then open `http://127.0.0.1:5174`.

## Project Shape

```text
src/
  dindbos/       runtime modules
  demo/          portfolio demo mount
  styles/        default DindbOS theme
```

## Virtual File System

The demo now boots with a Linux-like tree:

```text
/
  bin/                  shell commands
  boot/                 runtime boot notes
  dev/                  browser devices
  etc/                  os-release, motd, shell config
  home/guest/Desktop/   user desktop symlinks
  lib/dindbos/          runtime docs
  mnt/portfolio/        mounted portfolio projects and decks
  proc/                 runtime status files
  usr/share/applications/
  var/log/
```

The desktop is rendered from `/home/guest/Desktop`, not from hard-coded buttons. Apps live under `/usr/share/applications`, and portfolio content is mounted under `/mnt/portfolio`.

Terminal commands currently include read and write operations against the shared virtual filesystem:

```text
help, history, clear, pwd, cd, ls, tree, find, cat, grep, stat, readlink
mkdir, touch, rm, cp, mv, echo >, echo >>, open, apps, whoami, uname, neofetch, date
```

## Goal

The goal is to make DindbOS.js useful as an open-source web desktop runtime, while this repository also serves as the canonical demo.
