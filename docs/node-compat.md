# DindbOS NodeCompat

NodeCompat is the first JavaScript runtime layer above the DindbOS virtual filesystem.

```text
cd /home/guest/Documents
npm install is-number@7.0.0
node -e "console.log(require('is-number')(7))"
```

It currently supports:

- `node <file>`
- `node -e <code>`
- CommonJS `require`
- relative, absolute, and package module resolution
- package `main` and simple `exports` resolution
- JSON modules
- module cache
- VFS-backed `fs.readFileSync`, `fs.writeFileSync`, `fs.existsSync`, `fs.statSync`, `fs.readdirSync`, `fs.mkdirSync`, and `fs.rmSync`
- `path`, `process`, and `Buffer` facades

This is not a full Node.js runtime. It does not provide POSIX syscalls, native addons, networking, child processes, worker threads, ESM package loading, or lifecycle script execution.

The goal is to support browser-safe JavaScript packages well enough that DindbOS apps can depend on real npm packages without WebContainers.
