import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react(), {
    name: "dindbos-demo-notices",
    generateBundle() {
      for (const fileName of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(new URL(fileName, import.meta.url), "utf8") });
      }
    },
  }],
  optimizeDeps: { entries: ["index.html"] },
  build: { outDir: "dist-demo" },
});
