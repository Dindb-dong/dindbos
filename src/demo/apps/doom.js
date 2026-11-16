import React, { useEffect, useId, useRef, useState } from "react";
import { DindbOSApp } from "../../sdk/react.js";
import { MAX_WAD_BYTES, validateIWAD } from "./doom-wad.js";
import "./doom.css";

const h = React.createElement;
const KEY_CODES = new Map([
  ["ArrowLeft", 0xac], ["ArrowUp", 0xad], ["ArrowRight", 0xae], ["ArrowDown", 0xaf],
  ["Enter", 13], ["Escape", 27], ["Space", 32], ["KeyZ", 0x9d],
  ...Array.from({ length: 7 }, (_, i) => [`Digit${i + 1}`, 49 + i]),
]);
const TICK_MS = 1000 / 35;

function DoomGame() {
  const canvas = useRef(null);
  const current = useRef(null);
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const controlsId = useId();

  useEffect(() => {
    function visibilityChanged() {
      if (document.hidden) current.current?.releaseKeys();
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("blur", releaseKeys);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("blur", releaseKeys);
      current.current?.stop();
    };
  }, []);

  function releaseKeys() {
    current.current?.releaseKeys();
  }

  function handleKey(event) {
    const session = current.current;
    const key = KEY_CODES.get(event.code);
    if (!session?.ready || key === undefined) return;
    if (event.type === "keyup") {
      if (!session.keys.delete(key)) return;
      session.worker.postMessage({ type: "up", key });
    } else {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!event.repeat && !session.keys.has(key)) {
        session.keys.add(key);
        session.worker.postMessage({ type: "down", key });
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }

  async function start(event) {
    event.preventDefault();
    if (!file) return;
    current.current?.stop();
    setError("");
    setPhase("loading");

    let frame = 0;
    let startupTimeout;
    let lastTick = 0;
    let pending = true;
    const session = {
      keys: new Set(),
      worker: null,
      ready: false,
      releaseKeys() {
        for (const key of session.keys) session.worker.postMessage({ type: "up", key });
        session.keys.clear();
      },
      stop() {
        cancelAnimationFrame(frame);
        clearTimeout(startupTimeout);
        session.worker?.terminate();
        if (current.current === session) current.current = null;
      },
    };
    current.current = session;

    function fail(message) {
      if (current.current !== session) return;
      session.stop();
      setError(message);
      setPhase("idle");
    }

    function tick(now) {
      const elapsed = now - lastTick;
      if (!document.hidden && !pending && elapsed >= TICK_MS) {
        lastTick = now - elapsed % TICK_MS;
        pending = true;
        session.worker.postMessage({ type: "tick" });
      }
      frame = requestAnimationFrame(tick);
    }

    try {
      if (file.size > MAX_WAD_BYTES) throw new Error("Choose an IWAD of 64 MiB or less.");
      const wad = await file.arrayBuffer();
      if (current.current !== session) return;
      const mode = validateIWAD(new Uint8Array(wad));
      const surface = canvas.current;
      const context = surface.getContext("2d");
      if (!context) throw new Error("This browser could not create a 2D game surface.");
      context.clearRect(0, 0, 320, 200);

      const worker = new Worker(new URL("./doom-worker.js", import.meta.url), { type: "module" });
      session.worker = worker;
      worker.onerror = () => fail("Could not start the Doom engine worker.");
      worker.onmessage = ({ data }) => {
        if (current.current !== session) return;
        if (data.error) {
          fail(data.error);
          return;
        }
        context.putImageData(new ImageData(data.pixels, 320, 200), 0, 0);
        pending = false;
        if (!session.ready) {
          clearTimeout(startupTimeout);
          session.ready = true;
          setPhase("playing");
          frame = requestAnimationFrame(tick);
        }
      };
      startupTimeout = setTimeout(() => fail("The Doom engine timed out while starting."), 15000);
      const engineURL = new URL(`${import.meta.env.BASE_URL}vendor/doom/wasmdoom.wasm`, document.baseURI).href;
      worker.postMessage({ type: "start", engineURL, mode, wad }, [wad]);
    } catch (error) {
      fail(error.message || "Could not open the IWAD.");
    }
  }

  return h("section", { className: "demo-doom" },
    h("form", { className: "demo-doom-loader", onSubmit: start },
      h("label", null, "Local Doom IWAD", h("input", {
        type: "file", accept: ".wad", onChange: (event) => setFile(event.currentTarget.files[0] || null),
      })),
      h("button", { type: "submit", disabled: !file }, phase === "idle" ? "Start Doom" : "Restart Doom")),
    h("p", { id: controlsId }, "Focus the game to play. Arrow keys move and turn, Z fires, Space opens doors, and Enter and Esc control menus. Audio is off."),
    error && h("p", { role: "alert" }, error),
    phase === "loading" && h("p", { role: "status" }, "Loading Doom…"),
    h("div", { className: "demo-doom-screen" },
      h("canvas", {
        ref: canvas, width: 320, height: 200, role: "application", "aria-label": "Doom game",
        tabIndex: phase === "playing" ? 0 : -1, "aria-describedby": controlsId,
        onBlur: releaseKeys, onKeyDown: handleKey, onKeyUp: handleKey,
      })));
}

export function DoomApp() {
  return h(DindbOSApp, { id: "doom", name: "Doom", icon: "app", singleton: true, width: 650, height: 520 },
    h(DoomGame));
}
