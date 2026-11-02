export function mountBootScreen(options = {}) {
  const target = options.target;
  if (!target) throw new Error("A boot screen target is required");
  const host = document.createElement("section");
  host.className = "dos-boot-screen";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  host.innerHTML = `<div class="dos-boot-panel"><div class="dos-boot-header"><span>DindbOS</span><strong data-boot-status>Starting desktop…</strong></div><progress aria-label="Starting desktop" max="6" value="0"></progress><ol class="dos-boot-log" data-boot-log hidden></ol></div>`;
  target.appendChild(host);
  const status = host.querySelector("[data-boot-status]");
  const progress = host.querySelector("progress");
  const phases = new Map();
  let disposed = false;
  return {
    updatePhase(phase = {}) {
      if (disposed || !phase.id) return;
      phases.set(phase.id, phase.status);
      progress.value = [...phases.values()].filter((value) => ["complete", "recovered"].includes(value)).length;
      status.textContent = phase.status === "error" ? `Could not start ${phase.label || phase.id}` : "Starting desktop…";
    },
    async complete() {
      if (disposed) return;
      status.textContent = "Desktop ready";
      host.remove();
      disposed = true;
    },
    destroy() { disposed = true; host.remove(); },
  };
}
