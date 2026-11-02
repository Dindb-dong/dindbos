#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.env.DINDBOS_QA_OUTPUT || join(root, "internal/docs/qa/ui"));
let server;
let child;
let interrupted = false;
const stop = () => { interrupted = true; child?.kill("SIGTERM"); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  let url = process.env.DINDBOS_QA_URL;
  if (!url) {
    server = await createServer({
      root,
      logLevel: "error",
      server: { host: "127.0.0.1", port: Number(process.env.DINDBOS_UI_QA_PORT || 5198), strictPort: false, hmr: false, watch: null },
    });
    await server.listen();
    url = server.resolvedUrls.local[0];
  }
  await mkdir(output, { recursive: true });
  for (const [name, script] of [
    ["shell", "smoke-shell-browser.js"],
    ["dock", "smoke-dock-browser.js"],
    ["react", "smoke-react-apps.js"],
    ["editor", "smoke-editor-browser.js"],
    ["embed", "smoke-embed-browser.js"],
  ]) {
    if (interrupted) break;
    console.log(`UI verification: ${name}`);
    await new Promise((complete, fail) => {
      child = spawn(process.execPath, [join(root, "scripts", script)], {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, DINDBOS_QA_URL: url, DINDBOS_QA_OUTPUT: join(output, name), DINDBOS_EMBED_QA_OUTPUT: join(output, "embed") },
      });
      child.once("error", fail);
      child.once("close", (code, signal) => {
        child = null;
        if (code === 0) complete();
        else fail(new Error(`${script} failed (${signal || `exit ${code}`})`));
      });
    });
  }
  if (!interrupted) console.log(`UI verification passed; screenshots: ${output}`);
} catch (error) {
  if (!interrupted) console.error(error);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  child?.kill("SIGTERM");
  await server?.close();
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  if (interrupted) process.exitCode = 130;
}
