import { createAndBootDindbOS } from "dindbos";
import "dindbos/styles.css";
import "./host.css";
import { apps } from "./apps/index.js";
import config from "../dindbos.config.js";

const desktop = createAndBootDindbOS({ ...config, root: "#app", apps, launch: ["hello"] });
desktop.catch(console.error);
if (import.meta.hot) import.meta.hot.dispose(() => { desktop.then((os) => os.destroy()).catch(console.error); });
