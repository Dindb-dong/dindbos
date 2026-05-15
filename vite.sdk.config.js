import { mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const entrypoints = {
  index: resolve("src/sdk/index.js"),
  desktop: resolve("src/sdk/desktop.js"),
  builtins: resolve("src/sdk/builtins.js"),
  testing: resolve("src/sdk/testing.js"),
  react: resolve("src/sdk/react.js"),
};

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "dist",
    sourcemap: true,
    lib: {
      entry: entrypoints,
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [sdkArtifactsPlugin()],
});

function sdkArtifactsPlugin() {
  return {
    name: "dindbos-sdk-artifacts",
    closeBundle() {
      mkdirSync("dist", { recursive: true });
      copyFileSync("src/styles/dindbos.css", "dist/styles.css");
      for (const name of Object.keys(entrypoints)) {
        copyFileSync(`src/sdk/${name}.d.ts`, `dist/${name}.d.ts`);
      }
    },
  };
}
