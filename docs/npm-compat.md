# DindbOS npm Compatibility

DindbOS includes an early npm-compatible installer for browser-safe JavaScript packages.

```text
cd /home/guest/Documents
npm install is-number@7.0.0
ls node_modules/is-number
cat package.json
cat package-lock.json
node -e "console.log(require('is-number')(7))"
node --input-type=module -e "import isNumber from 'is-number'; console.log(isNumber(7))"
```

Smoke test:

```text
npm run smoke:npm-node
```

The smoke test installs `is-number@7.0.0` from the real npm registry into a VFS project, verifies `package-lock.json`, then runs the package through NodeCompat CommonJS and simple ESM paths.

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
- record `peerDependencies` and `optionalDependencies` without auto-installing them
- record native/lifecycle warnings for packages with install scripts, `node-gyp`, bundled dependencies, or `os`/`cpu` restrictions

Installed CommonJS packages can run through NodeCompat:

- `node <file>`
- `node -e <code>`
- `node --input-type=module -e <code>`
- `.mjs` files with simple static `import`/`export`
- `.js` files inside a `package.json` with `"type": "module"`
- package lookup through parent `node_modules` folders
- `package.json` `main` and simple `exports` resolution
- VFS-backed `fs`, `path`, `process`, and `Buffer` facades

Policy for dependencies beyond regular `dependencies`:

- `peerDependencies` are recorded in install records and `package-lock.json`, but they are not auto-installed.
- `optionalDependencies` are recorded in install records and `package-lock.json`, but they are not auto-installed.
- Packages with lifecycle/native signals install as files, but the record includes DindbOS warnings because lifecycle scripts and native compilation are not executed.
- `npm run smoke:npm-node` verifies this policy with a fixture package that declares peer dependencies, optional dependencies, an install script, and `node-gyp`.

This is not full Node.js yet. Current limits:

- no `devDependencies`
- no automatic peer dependency install
- no automatic optional dependency install
- no lifecycle scripts
- no native addons
- no `node-gyp`
- no `child_process`
- partial Node built-ins only
- simple ESM transform only, not full JavaScript module semantics

The next layer is broader Node built-ins, richer ESM semantics, optional dependency handling, and JS-only lifecycle scripts.
