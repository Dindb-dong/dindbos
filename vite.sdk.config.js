import { cpSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const entrypoints = {
  index: resolve("src/sdk/index.js"),
  desktop: resolve("src/sdk/desktop.js"),
  builtins: resolve("src/sdk/builtins.js"),
  testing: resolve("src/sdk/testing.js"),
  react: resolve("src/sdk/react.js"),
  create: resolve("src/sdk/create.js"),
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
      external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "node:fs/promises", "node:path", "node:url"],
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
      const styles = ["dindbos", "theme", "shell", "windows", "dock", "apps", "settings", "files", "browser", "productivity", "media", "clock", "applications", "liquid-glass", "control-center"];
      writeFileSync("dist/styles.css", styles.map((name) => readFileSync(`src/styles/${name}.css`, "utf8")).join("\n"));
      cpSync("src/styles/wallpapers", "dist/wallpapers", { recursive: true });
      for (const name of Object.keys(entrypoints)) {
        copyFileSync(`src/sdk/${name}.d.ts`, `dist/${name}.d.ts`);
      }
      copyFileSync("src/sdk/pages-workflow.yml", "dist/pages-workflow.yml");
      cpSync("src/sdk/create-template", "dist/create-template", { recursive: true });
      if (existsSync("src/sdk/create-templates")) cpSync("src/sdk/create-templates", "dist/create-templates", { recursive: true });
    },
  };
}
