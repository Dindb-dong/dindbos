# DindbOS npm Compatibility

DindbOS includes an early npm-compatible installer for browser-safe JavaScript packages.

```text
cd /home/guest/Documents
npm install is-number@7.0.0
ls node_modules/is-number
cat package.json
cat package-lock.json
node -e "console.log(require('is-number')(7))"
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
- recursively install regular package `dependencies`
- hoist compatible dependencies and nest version conflicts under the dependent package

Installed CommonJS packages can run through NodeCompat:

- `node <file>`
- `node -e <code>`
- package lookup through parent `node_modules` folders
- `package.json` `main` and simple `exports` resolution
- VFS-backed `fs`, `path`, `process`, and `Buffer` facades

This is not full Node.js yet. Current limits:

- no `devDependencies`, `peerDependencies`, or `optionalDependencies`
- no lifecycle scripts
- no native addons
- no `node-gyp`
- no `child_process`
- partial Node built-ins only
- no ESM package loader yet

The next layer is broader Node built-ins, ESM package loading, optional dependency handling, and JS-only lifecycle scripts.
