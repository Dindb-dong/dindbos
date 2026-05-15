import { createAndBootDindbOS } from "dindbos";
import "dindbos/styles.css";
import { helloApp } from "./apps/hello.js";
import config from "../dindbos.config.js";

boot();

async function boot() {
  await createAndBootDindbOS({
    root: "#app",
    fileSystem: config.fileSystem,
    apps: [helloApp],
    builtins: { includePortfolio: false },
    launch: ["hello", "files", "terminal"],
    storage: config.storage,
    isolation: config.isolation,
  });
}
