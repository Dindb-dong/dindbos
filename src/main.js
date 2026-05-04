import { DindbOS } from "./dindbos/index.js?v=20260422-browserd";
import { installBuiltinApps } from "./dindbos/apps/builtins.js?v=20260422-browserd";
import { demoFileSystem, portfolioData } from "./demo/portfolio-demo.js?v=20260422-browserd";

const os = new DindbOS({
  root: "#dindbos-root",
  fileSystem: demoFileSystem,
  session: {
    user: "guest",
    product: "DindbOS.js",
  },
});

await os.loadPersistentFileSystem();
await os.runBootPhase("package-registry-load", () => os.packages.bootstrap());
await os.runBootPhase("app-registry-load", () => installBuiltinApps(os, { portfolioData }));
os.boot();

window.dindbos = os;
