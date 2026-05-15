import { createAndBootDindbOS } from "dindbos";
import "dindbos/styles.css";

boot();

async function boot() {
  await createAndBootDindbOS({
    root: "#app",
    fileSystem: {
      "/home/guest/readme.md": "# DindbOS in Vanilla Vite\n",
    },
    builtins: { includePortfolio: false },
    launch: ["files", "terminal"],
  });
}
