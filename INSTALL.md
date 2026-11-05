# Install dindbOS

## Use the package

Install the latest published package. The README examples require dindbos 0.2.0 or later:

```sh
npm install dindbos
npm exec --package=dindbos@latest -- create-dindbos my-desktop --template react --yes
```

The CLI is distributed by `dindbos`. Do not assume `npm create dindbos` or `npx create-dindbos` refers to the same package. The CLI creates files but does not run `npm install`, initialize Git, publish, or deploy.

## Build this source revision

Use this path to develop the SDK or try changes that have not been published:

```sh
git clone https://github.com/Dindb-dong/dindbos.git
cd dindbos
npm ci
npm run build:sdk
npm pack
```

`npm pack` prints a filename such as `dindbos-VERSION.tgz`; use the actual filename in the commands below. Keep the package in a stable location until dependent projects have installed it.

In an existing host project:

```sh
npm install /absolute/path/to/dindbos-VERSION.tgz
```

To run the packed CLI without relying on another published package:

```sh
npm exec --package=/absolute/path/to/dindbos-VERSION.tgz -- create-dindbos my-desktop --template react --yes --json
```

The generated `package.json` requests the source package's version. If that version is not published, replace its `dependencies.dindbos` value with `file:/absolute/path/to/dindbos-VERSION.tgz` before running `npm install` in the generated project.

## Verify

```sh
cd my-desktop
npm install
npm run build
npm exec --no -- create-dindbos doctor --json
npm run dev
```

Open the local URL. Hello should launch, respond to input, minimize and restore with its state intact, close, and reopen. In an embedded host, confirm the surrounding page still scrolls and accepts keyboard input. React hosts should also be checked under StrictMode and route unmounting.

No credentials or paid service are required for the ordinary desktop. Optional browser features may need permission, HTTPS, host headers, or an optional companion. Do not enable those features merely to complete installation.

## Existing projects

Give an agent the exact package path/version, host route, container, and app you want. Read [the agent guide](docs/agent-guide.md), preserve existing files, and use the public SDK. `--force` is explicit overwrite authorization for the target files; inspect them first.
