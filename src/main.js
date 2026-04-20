import { DindbOS } from "./dindbos/index.js";
import { installBuiltinApps } from "./dindbos/apps/builtins.js";
import { demoFileSystem, portfolioData } from "./demo/portfolio-demo.js";

const os = new DindbOS({
  root: "#dindbos-root",
  fileSystem: demoFileSystem,
  session: {
    user: "guest",
    product: "DindbOS.js",
  },
});

installBuiltinApps(os, { portfolioData });
os.boot();

window.dindbos = os;
