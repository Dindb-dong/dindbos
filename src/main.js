import { DindbOS } from "./dindbos/index.js?v=20260504-runtime";
import { installBuiltinApps } from "./dindbos/apps/builtins.js?v=20260504-runtime";
import { demoFileSystem, portfolioData } from "./demo/portfolio-demo.js?v=20260504-runtime";
import { mountBootScreen } from "./ui/boot-screen.js?v=20260506-real-boot";

boot();

async function boot() {
  const bootScreen = mountBootScreen({ target: document.body });
  const os = new DindbOS({
    root: "#dindbos-root",
    fileSystem: demoFileSystem,
    session: {
      user: "guest",
      product: "DindbOS.js",
    },
  });

  bootScreen.updatePhase({
    id: "kernel-constructor",
    label: "Kernel constructor",
    status: "complete",
    detail: "runtime managers allocated",
  });
  os.bus.on("boot:phase", (phase) => bootScreen.updatePhase(phase));

  await os.loadPersistentFileSystem();
  await os.runBootPhase("package-registry-load", () => os.packages.bootstrap());
  await os.runBootPhase("app-registry-load", () => installBuiltinApps(os, { portfolioData }));
  os.boot();
  await os.registerServiceWorkerBoot();

  await bootScreen.complete();

  if (new URLSearchParams(window.location.search).get("qa") === "fresh") {
    os.launch("portfolio");
    os.launch("files", { path: os.session.home || "/" });
  }
}
