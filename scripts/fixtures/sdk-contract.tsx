import { createDindbOS, defineApp, type DindbOSAppContext } from "../../src/sdk/index.js";
import { DindbOSDesktop, DindbOSApp, useDindbOSApp } from "../../src/sdk/react.js";

class NotesApp {
  id = "notes";
  name = "Notes";
  render({ os, content, window }: DindbOSAppContext) {
    content.textContent = String(os.state.get("draft", "Hello"));
    window.setTitle(this.name);
    const placement = window.setBounds({ left: 40, top: 60 });
    if (placement) content.dataset.windowLeft = String(placement.left);
    return () => { content.textContent = ""; };
  }
}
const notes = defineApp(new NotesApp());
const hello = defineApp({ id: "hello", category: "productivity", accepts: ["text/plain"], associationPriority: 20, chrome: "integrated", sidebarWidth: 180, minWidth: 230, minHeight: 408, menus: { file: [{ label: "Minimize", accelerator: "Mod+Shift+M", run({ window }) { window.minimize(); } }] }, render({ window }) { window.setTitle("Hello"); } });
function Counter() {
  const { window, os } = useDindbOSApp();
  return <button onClick={() => { os.state.set("count", 1); window.minimize(); }}>Minimize</button>;
}
export const desktop = <DindbOSDesktop storage={{ backend: "memory", name: "typed-host" }}
  theme={{ mode: "dark", accent: "#287a58", wallpaper: "meadow", dockSize: 52 }}
  apps={[notes, hello]} launch={["counter"]}
  ui={{ liquidGlass: { strength: 1, blur: 0.6, maxSurfaces: 18 }, slots: { menubar({ element, defaultRender }) { defaultRender(); element.dataset.custom = "true"; return () => {}; } } }}>
  <DindbOSApp id="counter" name="Counter" chrome="document" minWidth={230} minHeight={408} icon={<span>C</span>}><Counter /></DindbOSApp>
</DindbOSDesktop>;
void createDindbOS({ apps: [notes], configure(os) { os.setAppearance({ mode: "light" }); } });
// @ts-expect-error Invalid theme modes must be rejected for consumers.
void createDindbOS({ theme: { mode: "night" } });
// @ts-expect-error App definitions must include their mount function.
defineApp({ id: "missing-render" });
