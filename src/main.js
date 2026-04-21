import { DindbOS } from "./dindbos/index.js?v=20260421-files-app-2";
import { installBuiltinApps } from "./dindbos/apps/builtins.js?v=20260421-files-app-2";
import { demoFileSystem, portfolioData } from "./demo/portfolio-demo.js?v=20260421-files-app-2";

const os = new DindbOS({
  root: "#dindbos-root",
  fileSystem: demoFileSystem,
  session: {
    user: "guest",
    product: "DindbOS.js",
  },
});

await os.loadPersistentFileSystem();
installBuiltinApps(os, { portfolioData });
os.packages.bootstrap();
os.boot();

window.dindbos = os;
