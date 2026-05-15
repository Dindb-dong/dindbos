import { mountBootScreen } from "../ui/boot-screen.js";
import { bootDindbOS, createAndBootDindbOS, createDindbOS } from "./index.js";

export { mountBootScreen };

export async function mountDindbOSDesktop(options = {}) {
  const bootScreen = options.bootScreen === false ? null : mountBootScreen({
    target: options.bootTarget || document.body,
  });
  const os = await createDindbOS(options);
  if (bootScreen) os.bus.on("boot:phase", (phase) => bootScreen.updatePhase(phase));
  await bootDindbOS(os, options);
  if (bootScreen) await bootScreen.complete();
  return os;
}

export { bootDindbOS, createAndBootDindbOS, createDindbOS };
