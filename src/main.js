import { DindbOS } from "./dindbos/index.js?v=20260421-opfs-inodes";
import { installBuiltinApps } from "./dindbos/apps/builtins.js?v=20260421-opfs-inodes";
import { demoFileSystem, portfolioData } from "./demo/portfolio-demo.js?v=20260421-opfs-inodes";

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
