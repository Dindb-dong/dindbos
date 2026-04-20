# DindbOS npm Compatibility

DindbOS includes an early npm-compatible installer for browser-safe JavaScript packages.

```text
cd /home/guest/Documents
npm install is-number@7.0.0
ls node_modules/is-number
cat package.json
cat package-lock.json
```

The installer performs real npm registry work:

- fetch package metadata from `https://registry.npmjs.org`
- resolve a version from exact, `latest`, `^`, `~`, or `>=` ranges
- download the package `.tgz`
- verify npm `sha512`, `sha384`, `sha256`, or legacy `sha1` integrity
- gunzip and read the tarball
- write files into DindbOS VFS under `node_modules`
- update `package.json`
- write `package-lock.json`

This is not full Node.js yet. Current limits:

- direct dependencies only
- no lifecycle scripts
- no native addons
- no `node-gyp`
- no `child_process`
- no Node built-ins such as `fs`, `net`, or `http`
- no CommonJS or ESM module resolver yet

The next layer is NodeCompat: `require()`, package `exports` resolution, VFS-backed `fs`, `path`, `process`, `Buffer`, and `node index.js`.
