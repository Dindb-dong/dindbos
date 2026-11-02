const CITIES = [
  ["Local time", null], ["UTC", "UTC"], ["Seoul", "Asia/Seoul"], ["Tokyo", "Asia/Tokyo"],
  ["London", "Europe/London"], ["Paris", "Europe/Paris"], ["New York", "America/New_York"],
  ["Los Angeles", "America/Los_Angeles"], ["Sydney", "Australia/Sydney"], ["Singapore", "Asia/Singapore"],
];

// Running time is measured against a monotonic clock, including background-tab throttling.
export function createChronometer(now = () => performance.now()) {
  let elapsed = 0;
  let started = null;
  return {
    get running() { return started !== null; },
    read() { return elapsed + (started === null ? 0 : Math.max(0, now() - started)); },
    start() { if (started === null) started = now(); },
    pause() { elapsed = this.read(); started = null; },
    reset() { elapsed = 0; started = null; },
  };
}

export function renderClock(os, content, context = {}, windowApi) {
  let controller = new AbortController();
  const stopwatch = createChronometer();
  const countdown = createChronometer();
  let mode = ["world", "stopwatch", "timer"].includes(context.mode) ? context.mode : "world";
  let cities = [0, 1, 2];
  let laps = [];
  let lastLap = 0;
  let duration = 300000;
  let finished = false;
  let lastSecond = -1;
  let disposed = false;
  windowApi?.setTitle("Clock");
  const listen = (node, event, callback) => node.addEventListener(event, callback, { signal: controller.signal });
  const tick = () => {
    if (disposed) return;
    const remaining = Math.max(0, duration - countdown.read());
    if (countdown.running && remaining === 0) {
      countdown.pause();
      finished = true;
      draw();
      content.querySelector('[data-clock-announcement]').textContent = "Timer finished";
      return;
    }
    if (mode === "world") {
      const second = Math.floor(Date.now() / 1000);
      if (second === lastSecond) return;
      lastSecond = second;
      const date = new Date();
      content.querySelectorAll("[data-clock-city]").forEach((card) => {
        const [, zone] = CITIES[Number(card.dataset.clockCity)];
        const options = zone ? { timeZone: zone } : {};
        card.querySelector("time").textContent = new Intl.DateTimeFormat(undefined, { ...options, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
        card.querySelector(".clock-city-date").textContent = new Intl.DateTimeFormat(undefined, { ...options, weekday: "short", month: "short", day: "numeric" }).format(date);
        const parts = new Intl.DateTimeFormat("en-US", { ...options, hour: "numeric", minute: "numeric", second: "numeric", hour12: false }).formatToParts(date);
        const get = (type) => Number(parts.find((item) => item.type === type)?.value || 0);
        card.querySelector("[data-hour]").setAttribute("transform", `rotate(${(get("hour") % 12) * 30 + get("minute") / 2} 50 50)`);
        card.querySelector("[data-minute]").setAttribute("transform", `rotate(${get("minute") * 6 + get("second") / 10} 50 50)`);
        card.querySelector("[data-second]").setAttribute("transform", `rotate(${get("second") * 6} 50 50)`);
      });
    } else if (mode === "stopwatch") {
      content.querySelector("[data-clock-display]").textContent = formatDuration(stopwatch.read(), true);
    } else {
      content.querySelector("[data-clock-display]").textContent = formatDuration(Math.ceil(remaining / 1000) * 1000);
      const progress = content.querySelector(".clock-timer-ring");
      progress.style.setProperty("--timer-progress", `${duration ? remaining / duration * 100 : 0}%`);
    }
  };
  const draw = () => {
    controller.abort();
    controller = new AbortController();
    lastSecond = -1;
    content.innerHTML = `<section class="clock-app"><header class="clock-toolbar"><div role="tablist" aria-label="Clock tools">${[["world", "World Clock"], ["stopwatch", "Stopwatch"], ["timer", "Timer"]].map(([value, label]) => `<button type="button" role="tab" aria-selected="${mode === value}" data-clock-mode="${value}">${label}</button>`).join("")}</div></header><div class="clock-pane" role="tabpanel" aria-label="${mode === "world" ? "World Clock" : mode === "timer" ? "Timer" : "Stopwatch"}">${mode === "world" ? worldMarkup(cities) : mode === "stopwatch" ? stopwatchMarkup(stopwatch.running, laps) : timerMarkup(countdown.running, countdown.read() > 0, duration, finished)}</div><p class="clock-announcement" data-clock-announcement role="status" aria-live="polite">${finished ? "Timer finished" : ""}</p><footer class="clock-footer">${mode === "world" ? "Times use your device clock." : "Timing continues across tabs. Closing this window stops it."}</footer></section>`;
    content.querySelectorAll("[data-clock-mode]").forEach((button) => listen(button, "click", () => { mode = button.dataset.clockMode; draw(); }));
    const tabs = content.querySelector('[role="tablist"]');
    listen(tabs, "keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const values = ["world", "stopwatch", "timer"];
      const index = values.indexOf(mode);
      mode = event.key === "Home" ? values[0] : event.key === "End" ? values[2] : values[(index + (event.key === "ArrowRight" ? 1 : 2)) % 3];
      draw();
      content.querySelector(`[data-clock-mode="${mode}"]`).focus();
    });
    if (mode === "world") {
      listen(content.querySelector('[data-add-city]'), "submit", (event) => {
        event.preventDefault();
        const index = Number(content.querySelector('[name="city"]').value);
        if (!cities.includes(index)) cities.push(index);
        draw();
      });
      content.querySelectorAll('[data-remove-city]').forEach((button) => listen(button, "click", () => { cities = cities.filter((index) => index !== Number(button.dataset.removeCity)); draw(); }));
    } else if (mode === "stopwatch") {
      listen(content.querySelector('[data-clock-start]'), "click", () => { if (stopwatch.running) stopwatch.pause(); else stopwatch.start(); draw(); });
      listen(content.querySelector('[data-clock-lap]'), "click", () => {
        if (!stopwatch.running) { stopwatch.reset(); laps = []; lastLap = 0; }
        else { const total = stopwatch.read(); laps.unshift({ number: laps.length + 1, split: total - lastLap }); lastLap = total; }
        draw();
      });
    } else {
      const inputs = content.querySelectorAll('[data-timer-input]');
      const update = () => {
        const valid = [...inputs].every((input) => input.value !== "" && input.validity.valid);
        const validation = content.querySelector('[data-timer-validation]');
        validation.hidden = valid;
        content.querySelector('[data-clock-start]').disabled = !valid;
        if (!valid) return;
        const [hours, minutes, seconds] = [...inputs].map((input) => Math.max(0, Math.min(Number(input.max), Math.floor(Number(input.value) || 0))));
        duration = (hours * 3600 + minutes * 60 + seconds) * 1000;
        countdown.reset(); finished = false; tick();
        content.querySelector('[data-clock-start]').disabled = duration === 0;
        content.querySelector('[data-clock-announcement]').textContent = "";
      };
      inputs.forEach((input) => listen(input, "input", update));
      listen(content.querySelector('[data-clock-start]'), "click", () => {
        if (countdown.running) countdown.pause();
        else if (duration > 0) { if (finished) countdown.reset(); finished = false; countdown.start(); }
        draw();
      });
      listen(content.querySelector('[data-clock-reset]'), "click", () => { countdown.reset(); finished = false; draw(); });
    }
    tick();
  };
  draw();
  const interval = setInterval(tick, 100);
  return () => { disposed = true; clearInterval(interval); controller.abort(); stopwatch.pause(); countdown.pause(); };
}

export function formatDuration(milliseconds, fractions = false) {
  const value = Math.max(0, milliseconds);
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor(value / 60000) % 60;
  const seconds = Math.floor(value / 1000) % 60;
  const result = `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return fractions ? `${result}.${String(Math.floor(value / 10) % 100).padStart(2, "0")}` : result;
}

function worldMarkup(cities) {
  return `<div class="clock-world-heading"><h1>World Clock</h1><form data-add-city><select name="city" aria-label="City">${CITIES.map(([name], index) => `<option value="${index}" ${cities.includes(index) ? "disabled" : index === CITIES.findIndex((_, candidate) => !cities.includes(candidate)) ? "selected" : ""}>${name}</option>`).join("")}</select><button type="submit" aria-label="Add city" ${cities.length === CITIES.length ? "disabled" : ""}>+</button></form></div><div class="clock-world-grid">${cities.map((index) => `<article class="clock-city" data-clock-city="${index}"><div class="clock-city-heading"><h2>${CITIES[index][0]}</h2><button type="button" data-remove-city="${index}" aria-label="Remove ${CITIES[index][0]}">×</button></div><svg class="clock-analog" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47"/>${Array.from({ length: 12 }, (_, tick) => `<path d="M50 7v5" transform="rotate(${tick * 30} 50 50)"/>`).join("")}<path class="clock-hand-hour" data-hour d="M50 50V28"/><path class="clock-hand-minute" data-minute d="M50 50V17"/><path class="clock-hand-second" data-second d="M50 57V11"/><circle class="clock-center" cx="50" cy="50" r="2.3"/></svg><time></time><p class="clock-city-date"></p></article>`).join("")}</div>`;
}
function stopwatchMarkup(running, laps) {
  return `<div class="clock-stopwatch"><h1 class="clock-visually-hidden">Stopwatch</h1><output role="timer" aria-live="off" aria-label="Elapsed time" data-clock-display class="clock-digits">00:00.00</output><div class="clock-actions"><button type="button" data-clock-lap>${running ? "Lap" : "Reset"}</button><button type="button" class="clock-primary ${running ? "is-stopping" : ""}" data-clock-start>${running ? "Stop" : "Start"}</button></div><ol class="clock-laps">${laps.map((lap) => `<li><span>Lap ${lap.number}</span><time>${formatDuration(lap.split, true)}</time></li>`).join("")}</ol></div>`;
}
function timerMarkup(running, hasElapsed, duration, finished) {
  const hours = Math.floor(duration / 3600000);
  const minutes = Math.floor(duration / 60000) % 60;
  const seconds = Math.floor(duration / 1000) % 60;
  return `<div class="clock-timer"><h1 class="clock-visually-hidden">Timer</h1><div class="clock-timer-ring ${finished ? "is-finished" : ""}"><output role="timer" aria-live="off" aria-label="Time remaining" data-clock-display class="clock-digits">05:00</output></div><div class="clock-timer-inputs">${[["Hours", hours, 99], ["Minutes", minutes, 59], ["Seconds", seconds, 59]].map(([label, value, max]) => `<label><input type="number" min="0" max="${max}" value="${value}" data-timer-input aria-label="${label}" ${running || hasElapsed ? "disabled" : ""}/><span>${label}</span></label>`).join("")}</div><p class="clock-timer-validation" data-timer-validation role="alert" hidden>Use whole numbers: hours 0–99, minutes and seconds 0–59.</p><div class="clock-actions"><button type="button" data-clock-reset>Reset</button><button type="button" class="clock-primary ${running ? "is-stopping" : ""}" data-clock-start ${duration === 0 ? "disabled" : ""}>${running ? "Pause" : finished ? "Start Again" : hasElapsed ? "Resume" : "Start"}</button></div></div>`;
}
