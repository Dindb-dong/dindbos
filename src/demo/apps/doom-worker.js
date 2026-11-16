let engine;

function engineError() {
  if (!engine) return;
  const view = new DataView(engine.memory.buffer, engine.wasmdoom_events_ptr(), engine.wasmdoom_events_len());
  for (let offset = 0; offset + 4 <= view.byteLength;) {
    const tag = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    offset += 4;
    if (offset + length > view.byteLength) break;
    if (tag === 3) {
      return new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + offset, length)).trim();
    }
    offset += length;
  }
}

function drawFrame() {
  engine.wasmdoom_tick();
  // The host uses video and input only. Drain upstream's event queue every tick.
  engine.wasmdoom_events_clear();
  const memory = engine.memory.buffer;
  const indices = new Uint8Array(memory, engine.wasmdoom_get_framebuffer(), 320 * 200);
  const palette = new Uint8Array(memory, engine.wasmdoom_get_palette(), 256 * 3);
  const pixels = new Uint8ClampedArray(indices.length * 4);
  for (let i = 0; i < indices.length; i++) {
    const color = indices[i] * 3;
    const pixel = i * 4;
    pixels[pixel] = palette[color];
    pixels[pixel + 1] = palette[color + 1];
    pixels[pixel + 2] = palette[color + 2];
    pixels[pixel + 3] = 255;
  }
  self.postMessage({ pixels }, [pixels.buffer]);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "start") {
      const response = await fetch(data.engineURL);
      if (!response.ok) throw new Error(`Could not load the Doom engine (HTTP ${response.status}).`);
      const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
      engine = instance.exports;
      const pointer = engine.wasmdoom_wad_alloc(data.wad.byteLength);
      if (!pointer) throw new Error("The engine could not allocate memory for this IWAD.");
      new Uint8Array(engine.memory.buffer, pointer, data.wad.byteLength).set(new Uint8Array(data.wad));
      const flags = new TextEncoder().encode(`-mode\0${data.mode}\0\0`);
      new Uint8Array(engine.memory.buffer, engine.wasmdoom_argv_ptr(), flags.length).set(flags);
      engine.wasmdoom_init();
      drawFrame();
    } else if (data.type === "tick") {
      drawFrame();
    } else if (data.type === "down") {
      engine.wasmdoom_keydown(data.key);
    } else if (data.type === "up") {
      engine.wasmdoom_keyup(data.key);
    }
  } catch (error) {
    self.postMessage({ error: engineError() || error.message || "The Doom engine stopped." });
  }
};
