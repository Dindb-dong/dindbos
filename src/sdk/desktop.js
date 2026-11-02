import { mountBootScreen } from "../ui/boot-screen.js";
import { bootDindbOS, createAndBootDindbOS, createDindbOS } from "./index.js";

export { mountBootScreen };

export async function mountDindbOSDesktop(options = {}) {
  const os = await createDindbOS(options);
  const bootScreen = options.bootScreen === false || !os.root ? null : mountBootScreen({ target: options.bootTarget || os.root });
  const off = bootScreen ? os.bus.on("boot:phase", (phase) => bootScreen.updatePhase(phase)) : () => {};
  try {
    await bootDindbOS(os, options);
    if (options.signal?.aborted) throw new DOMException("Desktop mount aborted", "AbortError");
    await bootScreen?.complete();
    return os;
  } catch (error) {
    try { await os.destroy(); } catch (cleanupError) { error.cleanupError = cleanupError; }
    throw error;
  } finally {
    off();
    bootScreen?.destroy();
  }
}

export { bootDindbOS, createAndBootDindbOS, createDindbOS };
