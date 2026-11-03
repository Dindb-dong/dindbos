import { CLOCK_LAND_PATH } from "./clock-world-map.js";
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
  let mode = ["world", "alarm", "stopwatch", "timer"].includes(context.mode) ? context.mode : "world";
  let cities = Array.isArray(context.cities) ? context.cities.map(name => CITIES.findIndex(([label]) => label === name)).filter(index => index >= 0) : [0, 1, 2];
  let alarms = [];
  let ringing = "";
  let addOpen = false;
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
    const now = Date.now();
    const due = alarms.find(alarm => alarm.enabled && now >= alarm.nextAt);
    if (due) { due.enabled = false; ringing = due.label || "Alarm"; draw(); return; }
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
      const terminator = content.querySelector("[data-clock-terminator]");
      const night = content.querySelector("[data-clock-night]");
      const solar = daylightPaths(date);
      terminator?.setAttribute("d", solar.line);
      night?.setAttribute("d", solar.night);
      content.querySelectorAll("[data-map-city-time]").forEach(label => {
        const zone = CITIES[Number(label.dataset.mapCityTime)][1];
        label.textContent = new Intl.DateTimeFormat(undefined, { ...(zone ? { timeZone: zone } : {}), hour: "2-digit", minute: "2-digit" }).format(date);
      });
      content.querySelectorAll("[data-clock-city]").forEach((card) => {
        const [, zone] = CITIES[Number(card.dataset.clockCity)];
        const options = zone ? { timeZone: zone } : {};
        card.querySelector("time").textContent = new Intl.DateTimeFormat(undefined, { ...options, hour: "2-digit", minute: "2-digit" }).format(date);
        card.querySelector(".clock-city-date").textContent = new Intl.DateTimeFormat(undefined, { ...options, weekday: "short", month: "short", day: "numeric" }).format(date);
        const parts = new Intl.DateTimeFormat("en-US", { ...options, hour: "numeric", minute: "numeric", second: "numeric", hour12: false }).formatToParts(date);
        const get = (type) => Number(parts.find((item) => item.type === type)?.value || 0);
        card.querySelector("[data-hour]").setAttribute("transform", `rotate(${(get("hour") % 12) * 30 + get("minute") / 2} 50 50)`);
        card.querySelector("[data-minute]").setAttribute("transform", `rotate(${get("minute") * 6 + get("second") / 10} 50 50)`);
        card.querySelector("[data-second]").setAttribute("transform", `rotate(${get("second") * 6} 50 50)`);
      });
    } else if (mode === "stopwatch") {
      content.querySelector("[data-clock-display]").textContent = formatDuration(stopwatch.read(), true);
    } else if (mode === "timer") {
      content.querySelector("[data-clock-display]").textContent = formatDuration(Math.ceil(remaining / 1000) * 1000);
      const progress = content.querySelector(".clock-timer-ring");
      progress.style.setProperty("--timer-progress", `${duration ? remaining / duration * 100 : 0}%`);
    }
  };
  const draw = () => {
    controller.abort();
    controller = new AbortController();
    lastSecond = -1;
    content.innerHTML = `<section class="clock-app" data-clock-view="${mode}"><header class="clock-toolbar" data-window-drag><div role="tablist" aria-label="Clock tools">${[["world", "World Clock"], ["alarm", "Alarm"], ["stopwatch", "Stopwatch"], ["timer", "Timer"]].map(([value, label]) => `<button type="button" role="tab" tabindex="${mode === value ? "0" : "-1"}" aria-selected="${mode === value}" data-clock-mode="${value}">${label}</button>`).join("")}</div>${["world", "alarm"].includes(mode) ? `<button type="button" class="clock-toolbar-add" data-clock-add aria-label="${mode === "world" ? "Add city" : "Add alarm"}" aria-expanded="${addOpen}">+</button>` : ""}</header><div class="clock-pane" role="tabpanel" aria-label="${mode === "world" ? "World Clock" : mode === "alarm" ? "Alarm" : mode === "timer" ? "Timer" : "Stopwatch"}">${mode === "world" ? worldMarkup(cities) : mode === "alarm" ? alarmMarkup(alarms) : mode === "stopwatch" ? stopwatchMarkup(stopwatch.running, laps) : timerMarkup(countdown.running, countdown.read() > 0, duration, finished)}</div><p class="clock-announcement" data-clock-announcement role="status" aria-live="polite">${ringing ? `${escapeClock(ringing)} alarm` : finished ? "Timer finished" : ""}${ringing ? '<button type="button" data-dismiss-alarm>Dismiss alarm</button>' : ""}</p>${mode === "world" ? "" : `<footer class="clock-footer">${mode === "alarm" ? "Alarms ring in this window while it stays open." : "Timing continues across tabs. Closing this window stops it."}</footer>`}${addOpen ? addClockMarkup(mode, cities) : ""}</section>`;
    const add = content.querySelector("[data-clock-add]");
    if (add) listen(add, "click", () => { addOpen = !addOpen; draw(); if (addOpen) content.querySelector(".clock-add-popover input, .clock-add-popover select")?.focus(); });
    const dismiss = content.querySelector("[data-dismiss-alarm]");
    if (dismiss) listen(dismiss, "click", () => { ringing = ""; draw(); });
    const closeAdd = content.querySelector("[data-close-clock-add]");
    if (closeAdd) listen(closeAdd, "click", () => { addOpen = false; draw(); content.querySelector("[data-clock-add]")?.focus(); });
    content.querySelectorAll("[data-clock-mode]").forEach((button) => listen(button, "click", () => { mode = button.dataset.clockMode; addOpen = false; draw(); }));
    listen(content.querySelector(".clock-app"), "keydown", event => {
      if (event.key === "Escape" && addOpen) { event.preventDefault(); event.stopPropagation(); addOpen = false; draw(); content.querySelector("[data-clock-add]")?.focus(); }
    });
    const tabs = content.querySelector('[role="tablist"]');
    listen(tabs, "keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const values = ["world", "alarm", "stopwatch", "timer"];
      const index = values.indexOf(mode);
      mode = event.key === "Home" ? values[0] : event.key === "End" ? values[3] : values[(index + (event.key === "ArrowRight" ? 1 : 3)) % 4];
      addOpen = false; draw();
      content.querySelector(`[data-clock-mode="${mode}"]`).focus();
    });
    if (mode === "world") {
      const cityForm = content.querySelector('[data-add-city]');
      if (cityForm) listen(cityForm, "submit", (event) => {
        event.preventDefault();
        const index = Number(content.querySelector('[name="city"]').value);
        if (!cities.includes(index)) cities.push(index);
        addOpen = false;
        draw();
      });
      content.querySelectorAll('[data-remove-city]').forEach((button) => listen(button, "click", () => { cities = cities.filter((index) => index !== Number(button.dataset.removeCity)); draw(); }));
    } else if (mode === "alarm") {
      const form = content.querySelector('[data-add-alarm]');
      if (form) listen(form, "submit", (event) => {
        event.preventDefault();
        const time = form.querySelector('[name="alarm-time"]').value;
        if (!/^\d{2}:\d{2}$/.test(time)) return;
        alarms.push({ id: `${Date.now()}-${alarms.length}`, time, label: form.querySelector('[name="alarm-label"]').value.trim().slice(0, 80), nextAt: nextAlarmTime(time), enabled: true });
        addOpen = false; draw();
      });
      content.querySelectorAll('[data-toggle-alarm]').forEach(input => listen(input, "change", () => { const alarm = alarms.find(item => item.id === input.dataset.toggleAlarm); alarm.enabled = input.checked; if (alarm.enabled) alarm.nextAt = nextAlarmTime(alarm.time); }));
      content.querySelectorAll('[data-delete-alarm]').forEach(button => listen(button, "click", () => { alarms = alarms.filter(item => item.id !== button.dataset.deleteAlarm); draw(); }));
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

const CITY_COORDINATES = [[0, 0], [51.48, 0], [37.57, 126.98], [35.68, 139.69], [51.51, -.13], [48.86, 2.35], [40.71, -74.01], [34.05, -118.24], [-33.87, 151.21], [1.35, 103.82]];
function coordinates(index) {
  if (index !== 0) return CITY_COORDINATES[index];
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const known = CITIES.findIndex(([, zone]) => zone === local);
  return CITY_COORDINATES[known > 0 ? known : 1];
}
export function daylightPaths(date) {
  const radians = Math.PI / 180;
  const day = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000;
  const declination = 23.44 * Math.sin(2 * Math.PI * (day - 80) / 365.2422) * radians;
  const longitude = 180 - (date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60) / 4;
  const points = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const latitude = Math.atan(-Math.cos((lon - longitude) * radians) / (Math.tan(declination) || .00001)) / radians;
    points.push(`${((lon + 180) / 360 * 1000).toFixed(2)},${((90 - latitude) / 180 * 500).toFixed(2)}`);
  }
  const edge = declination < 0 ? 0 : 500;
  const line = `M${points.join("L")}`;
  return { line, night: `${line}L1000,${edge}L0,${edge}Z` };
}
function worldMarkup(cities) {
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const mapCities = cities.filter(index => index !== 0 || !cities.some(candidate => candidate !== 0 && CITIES[candidate][1] === localZone));
  return `<div class="clock-world"><h1 class="clock-visually-hidden">World Clock</h1><svg class="clock-world-map" viewBox="0 0 1000 500" preserveAspectRatio="none" role="img" aria-label="World map with current approximate daylight"><rect class="clock-map-ocean" width="1000" height="500"/><path class="clock-map-land" d="${CLOCK_LAND_PATH}" fill-rule="evenodd"/>${Array.from({ length: 11 }, (_, index) => `<path class="clock-map-meridian" d="M${(index + 1) * 1000 / 12} 0V500"/>`).join("")}<path class="clock-map-night" data-clock-night/><path class="clock-map-terminator" data-clock-terminator/>${mapCities.map(index => { const [lat, lon] = coordinates(index), x = (lon + 180) / 360 * 1000, y = (90 - lat) / 180 * 500, labelX = x > 930 ? x - 8 : x + 8; return `<g class="clock-map-city"><circle cx="${x}" cy="${y}" r="4"/><text x="${labelX}" y="${y + 3}" text-anchor="${x > 930 ? "end" : "start"}">${escapeClock(CITIES[index][0])}</text><text class="clock-map-city-time" data-map-city-time="${index}" x="${labelX}" y="${y + 15}" text-anchor="${x > 930 ? "end" : "start"}"></text></g>`; }).join("")}</svg><div class="clock-world-grid">${cities.map((index) => `<article class="clock-city" data-clock-city="${index}"><button type="button" data-remove-city="${index}" aria-label="Remove ${CITIES[index][0]}">×</button><svg class="clock-analog" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47"/>${Array.from({ length: 12 }, (_, tick) => `<text x="${50 + 37 * Math.sin(tick * Math.PI / 6)}" y="${54 - 37 * Math.cos(tick * Math.PI / 6)}">${tick || 12}</text>`).join("")}<path class="clock-hand-hour" data-hour d="M50 50V28"/><path class="clock-hand-minute" data-minute d="M50 50V17"/><path class="clock-hand-second" data-second d="M50 57V11"/><circle class="clock-center" cx="50" cy="50" r="2.3"/></svg><div class="clock-city-caption"><h2>${CITIES[index][0]}</h2><time></time></div><p class="clock-city-date"></p></article>`).join("")}</div></div>`;
}
function addClockMarkup(mode, cities) {
  return `<div class="clock-add-popover" role="dialog" aria-label="${mode === "alarm" ? "New alarm" : "Add city"}"><header><h2>${mode === "alarm" ? "New Alarm" : "Add City"}</h2><button type="button" data-close-clock-add aria-label="Cancel">×</button></header>${mode === "alarm" ? `<form data-add-alarm><label>Time<input type="time" name="alarm-time" aria-label="Alarm time" required value="07:00"></label><label>Label<input name="alarm-label" aria-label="Alarm label" maxlength="80" placeholder="Alarm"></label><button type="submit">Add alarm</button></form>` : `<form data-add-city><select name="city" aria-label="City">${CITIES.map(([name], index) => `<option value="${index}" ${cities.includes(index) ? "disabled" : index === CITIES.findIndex((_, candidate) => !cities.includes(candidate)) ? "selected" : ""}>${name}</option>`).join("")}</select><button type="submit" ${cities.length === CITIES.length ? "disabled" : ""}>Add selected city</button></form>`}</div>`;
}
export function nextAlarmTime(time, now = new Date()) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new RangeError("Alarm time must be HH:mm");
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}
function alarmMarkup(alarms) {
  return `<div class="clock-alarms"><h1 class="clock-visually-hidden">Alarms</h1>${alarms.length ? alarms.map(alarm => `<article class="clock-alarm"><div><time>${alarm.time}</time><p>${escapeClock(alarm.label || "Alarm")}</p></div><label class="clock-alarm-switch"><input type="checkbox" data-toggle-alarm="${alarm.id}" aria-label="Enable ${escapeClock(alarm.label || alarm.time)}" ${alarm.enabled ? "checked" : ""}><span></span></label><button type="button" data-delete-alarm="${alarm.id}" aria-label="Delete ${escapeClock(alarm.label || alarm.time)}">×</button></article>`).join("") : '<div class="clock-alarm-empty"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="24" cy="26" r="16"/><path d="M24 16v11l7 4M7 11l7-7m20 0 7 7M13 40l-4 5m26-5 4 5"/></svg><h2>No Alarms</h2><p>Use + to add an alarm.</p></div>'}</div>`;
}
function escapeClock(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function stopwatchMarkup(running, laps) {
  return `<div class="clock-stopwatch"><h1 class="clock-visually-hidden">Stopwatch</h1><output role="timer" aria-live="off" aria-label="Elapsed time" data-clock-display class="clock-digits">00:00.00</output><div class="clock-actions"><button type="button" data-clock-lap>${running ? "Lap" : "Reset"}</button><button type="button" class="clock-primary ${running ? "is-stopping" : ""}" data-clock-start>${running ? "Stop" : "Start"}</button></div><ol class="clock-laps">${laps.map((lap) => `<li><span>Lap ${lap.number}</span><time>${formatDuration(lap.split, true)}</time></li>`).join("")}</ol></div>`;
}
function timerMarkup(running, hasElapsed, duration, finished) {
  const hours = Math.floor(duration / 3600000);
  const minutes = Math.floor(duration / 60000) % 60;
  const seconds = Math.floor(duration / 1000) % 60;
  return `<div class="clock-timer"><h1 class="clock-visually-hidden">Timer</h1><div class="clock-timer-ring ${finished ? "is-finished" : ""}"><output role="timer" aria-live="off" aria-label="Time remaining" data-clock-display class="clock-digits">05:00</output></div><div class="clock-timer-inputs">${[["Hours", hours, 99], ["Minutes", minutes, 59], ["Seconds", seconds, 59]].map(([label, value, max]) => `<label><input type="number" min="0" max="${max}" value="${value}" data-timer-input aria-label="${label}" ${running || hasElapsed ? "disabled" : ""}/><span>${label}</span></label>`).join("")}</div><p class="clock-timer-validation" data-timer-validation role="alert" hidden>Use whole numbers: hours 0–99, minutes and seconds 0–59.</p><div class="clock-actions"><button type="button" data-clock-reset>Reset</button><button type="button" class="clock-primary ${running ? "is-stopping" : ""}" data-clock-start ${duration === 0 ? "disabled" : ""}>${running ? "Pause" : finished ? "Start Again" : hasElapsed ? "Resume" : "Start"}</button></div></div>`;
}
