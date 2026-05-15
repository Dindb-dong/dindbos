#!/usr/bin/env node
import { readFileSync } from "node:fs";

const modules = {
  index: await import("../src/sdk/index.js"),
  desktop: await import("../src/sdk/desktop.js"),
  builtins: await import("../src/sdk/builtins.js"),
  testing: await import("../src/sdk/testing.js"),
  react: await import("../src/sdk/react.js"),
};

const expected = {
  index: [
    "BOOT_PHASES",
    "DindbOS",
    "applyDindbOSHostConfig",
    "bootDindbOS",
    "compatibilitySnapshot",
    "conformanceReport",
    "createAndBootDindbOS",
    "createDindbOS",
    "installBuiltinApps",
    "installDindbOSBuiltins",
    "isolationSnapshot",
    "normalizeDindbOSHostConfig",
    "prepareDindbOSHost",
    "publicHostConfig",
  ],
  desktop: [
    "bootDindbOS",
    "createAndBootDindbOS",
    "createDindbOS",
    "mountBootScreen",
    "mountDindbOSDesktop",
  ],
  builtins: [
    "BROWSER_LOCAL_HTML_SANDBOX",
    "installBuiltinApps",
    "installDindbOSBuiltins",
  ],
  testing: [
    "createBootedTestDindbOS",
    "createHeadlessDindbOS",
  ],
  react: [
    "DindbOSDesktop",
    "DindbOSProvider",
    "useDindbOS",
  ],
};

for (const [name, exports] of Object.entries(expected)) {
  assertDeepEqual(Object.keys(modules[name]).sort(), exports, `${name} source exports changed`);
  const declaration = readFileSync(`src/sdk/${name}.d.ts`, "utf8");
  for (const exportName of exports) {
    assert(declaration.includes(exportName), `${name}.d.ts missing ${exportName}`);
  }
}

const rootDeclaration = readFileSync("src/sdk/index.d.ts", "utf8");
[
  "CreateDindbOSOptions",
  "DindbOSHostApp",
  "DindbOSStorageAdapter",
  "DindbOSServiceWorkerConfig",
  "DindbOSDiagnosticsEvidence",
  "DindbOSHostConfig",
].forEach((name) => assert(rootDeclaration.includes(name), `root declaration missing ${name}`));

console.log("sdk api smoke ok export snapshots declarations");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual, expectedValue, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expectedValue);
  if (left !== right) throw new Error(`${message}: expected ${right} got ${left}`);
}
