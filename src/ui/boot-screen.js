const FINAL_WORD = "DindbOS";
const MAX_PARTICLES = 96;

export function mountBootScreen(options = {}) {
  const mountedAt = Date.now();
  const host = document.createElement("section");
  host.className = "dos-boot-screen";
  host.setAttribute("aria-live", "polite");
  host.innerHTML = `
    <div class="dos-boot-panel">
      <div class="dos-boot-header">
        <span>DindbOS</span>
        <strong data-boot-status>Starting runtime</strong>
      </div>
      <ol class="dos-boot-log" data-boot-log></ol>
    </div>
    <div class="dos-boot-flight" data-boot-flight aria-hidden="true"></div>
    <div class="dos-boot-word" data-boot-word aria-hidden="true"></div>
  `;
  (options.target || document.body).appendChild(host);

  const log = host.querySelector("[data-boot-log]");
  const status = host.querySelector("[data-boot-status]");
  const phases = new Map();

  return {
    updatePhase(phase = {}) {
      if (!phase.id) return;
      phases.set(phase.id, normalizePhase(phase));
      status.textContent = statusText(phase);
      renderLog(log, phases);
    },
    async complete() {
      const minimumVisibleMs = 1400;
      const remainingMs = Math.max(0, minimumVisibleMs - (Date.now() - mountedAt));
      if (remainingMs) await wait(remainingMs);
      status.textContent = "Runtime ready";
      renderLog(log, phases);
      await animateBootCompletion(host, phases);
      host.remove();
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizePhase(phase) {
  return {
    id: phase.id,
    label: phase.label || phase.id,
    status: phase.status || "pending",
    detail: phase.detail || "",
    durationMs: Number(phase.durationMs || 0),
  };
}

function statusText(phase) {
  if (phase.status === "running") return `Preparing ${phase.label}`;
  if (phase.status === "complete") return `${phase.label} ready`;
  if (phase.status === "recovered") return `${phase.label} recovered`;
  if (phase.status === "error") return `${phase.label} failed`;
  return "Preparing runtime";
}

function renderLog(log, phases) {
  log.innerHTML = [...phases.values()].map((phase) => `
    <li data-boot-phase-status="${escapeAttr(phase.status)}">
      <span>${escapeHtml(phase.label)}</span>
      <strong>${escapeHtml(phase.status)}</strong>
      <small>${escapeHtml(phase.detail || `${phase.durationMs}ms`)}</small>
    </li>
  `).join("");
}

function animateBootCompletion(host, phases) {
  const flight = host.querySelector("[data-boot-flight]");
  const word = host.querySelector("[data-boot-word]");
  const source = [...phases.values()].map((phase) => `${phase.label} ${phase.status} ${phase.detail}`).join(" ");
  const letters = source.replace(/\s+/g, "").slice(0, MAX_PARTICLES).split("");

  flight.innerHTML = letters.map((letter, index) => {
    const angle = (index / Math.max(1, letters.length)) * Math.PI * 2;
    const radius = 180 + ((index * 37) % 320);
    const x = Math.round(Math.cos(angle) * radius);
    const y = Math.round(Math.sin(angle) * (radius * 0.54));
    const delay = 40 + (index % 18) * 18;
    return `<span style="--boot-x:${x}px;--boot-y:${y}px;--boot-delay:${delay}ms">${escapeHtml(letter)}</span>`;
  }).join("");

  word.innerHTML = FINAL_WORD.split("").map((letter, index) => {
    const x = (index - 3) * 42;
    const y = index % 2 === 0 ? -34 : 34;
    return `<span style="--boot-word-x:${x}px;--boot-word-y:${y}px;--boot-word-delay:${560 + index * 70}ms">${escapeHtml(letter)}</span>`;
  }).join("");

  host.classList.add("is-completing");
  return new Promise((resolve) => {
    window.setTimeout(resolve, 2600);
  });
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
