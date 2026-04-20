import { DindbOS } from "./dindbos/index.js?v=20260420-stateful-terminal";
import { installBuiltinApps } from "./dindbos/apps/builtins.js?v=20260420-stateful-terminal";
import { demoFileSystem, portfolioData } from "./demo/portfolio-demo.js?v=20260420-stateful-terminal";

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
