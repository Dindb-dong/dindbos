import { bootDindbOS, createDindbOS } from "./sdk/index.js";
import { demoFileSystem, portfolioData } from "./demo/portfolio-demo.js?v=20260504-runtime";
import { mountBootScreen } from "./ui/boot-screen.js?v=20260506-real-boot";

boot();

async function boot() {
  const bootScreen = mountBootScreen({ target: document.body });
  const os = await createDindbOS({
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

  await bootDindbOS(os, {
    builtins: { portfolioData },
    serviceWorker: { enabled: true },
  });

  await bootScreen.complete();

  if (new URLSearchParams(window.location.search).get("qa") === "fresh") {
    os.launch("portfolio");
    os.launch("files", { path: os.session.home || "/" });
  }
}
