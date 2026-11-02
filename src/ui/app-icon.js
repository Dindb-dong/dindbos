import React, { useId, useState } from "react";
import { createRoot } from "react-dom/client";

const h = React.createElement;
const PALETTES = {
  welcome: ["#65b48a", "#287451"],
  files: ["#89d4ff", "#147be7"], folder: ["#8ed8ff", "#36a5e9"], directory: ["#8ed8ff", "#36a5e9"],
  browser: ["#77d9ff", "#0077ee"], calculator: ["#ffbd6c", "#ec7629"], terminal: ["#394453", "#111820"],
  activity: ["#334447", "#101c1e"], settings: ["#d4dbe1", "#8e9aa8"], portfolio: ["#66b88a", "#287451"],
  text: ["#fff", "#e3e9ef"], file: ["#fff", "#e3e9ef"], pdf: ["#fff", "#e3e9ef"], image: ["#fff", "#e3e9ef"],
};

export function mountAppIcon(element, icon) {
  const root = createRoot(element);
  let mounted = true;
  root.render(h(AppIcon, { icon }));
  return () => {
    if (!mounted) return;
    mounted = false;
    root.unmount();
  };
}

export function isImageIcon(icon) {
  return typeof icon === "string" && /^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]|blob:|\/|\.\.?\/)/i.test(icon);
}

export function AppIcon({ icon = "app" }) {
  const id = `dos-icon-${useId().replaceAll(":", "")}`;
  const [failedSource, setFailedSource] = useState(null);
  if (React.isValidElement(icon)) return h("span", { className: "dos-custom-icon" }, icon);
  if (isImageIcon(icon) && failedSource !== icon) {
    return h("img", { className: "dos-app-icon dos-image-icon", src: icon, alt: "", draggable: false, onError: () => setFailedSource(icon) });
  }
  const type = typeof icon === "string" && !isImageIcon(icon) ? icon : "app";
  const colors = PALETTES[type] || ["#a5b6c6", "#5f768b"];
  const folder = type === "folder" || type === "directory";
  return h("svg", { className: "dos-app-icon", viewBox: "0 0 64 64", fill: "none", focusable: false, "aria-hidden": true },
    h("defs", null,
      h("linearGradient", { id, x1: "12", y1: "3", x2: "48", y2: "63", gradientUnits: "userSpaceOnUse" },
        h("stop", { stopColor: colors[0] }), h("stop", { offset: "1", stopColor: colors[1] }))),
    folder
      ? h("g", null,
        h("path", { d: "M4 17a5 5 0 0 1 5-5h16l6 6h24a5 5 0 0 1 5 5v27a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6Z", fill: `url(#${id})` }),
        h("path", { d: "M4 25a5 5 0 0 1 5-5h46a5 5 0 0 1 5 5v25a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6Z", fill: "#69c8fc" }),
        h("path", { d: "M10 22h44", stroke: "#d6f3ff", strokeOpacity: ".7", strokeWidth: "1.2" }))
      : h("rect", { x: "3", y: "3", width: "58", height: "58", rx: "14", fill: `url(#${id})`, stroke: "#fff", strokeOpacity: ".5", strokeWidth: ".8" }),
    ...iconArtwork(type),
  );
}

function path(d, props = {}) { return h("path", { d, stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", ...props }); }
function iconArtwork(type) {
  if (type === "folder" || type === "directory") return [];
  if (type === "welcome") return [h("text", { key: "brand", x: "32", y: "46", textAnchor: "middle", fill: "#fff", fontSize: "39", fontWeight: "500", fontFamily: "-apple-system, system-ui, sans-serif" }, "D")];
  if (type === "files") return [h("g", { key: "face" },
    h("path", { d: "M32 4h15a14 14 0 0 1 14 14v29a14 14 0 0 1-14 14H29l8-29h-9Z", fill: "#d5efff" }),
    path("M20 24v4M44 24v4M19 41c7 7 19 7 26 0", { stroke: "#10457e" }), path("M33 18l-5 18h8v12", { stroke: "#10457e", strokeWidth: "1.8" }))];
  if (type === "browser") return [h("g", { key: "compass" },
    h("circle", { cx: "32", cy: "32", r: "23", fill: "#fff", fillOpacity: ".96" }),
    h("circle", { cx: "32", cy: "32", r: "19.5", stroke: "#54b6f5", strokeWidth: "2", strokeDasharray: "1 3.2" }),
    h("path", { d: "m43 20-6 17-17 7 7-18Z", fill: "#e34b4e" }), h("path", { d: "m43 20-6 17-17 7 11-12Z", fill: "#d8e4ec" }),
    h("circle", { cx: "32", cy: "32", r: "2", fill: "#fff" }))];
  if (type === "terminal") return [h("g", { key: "terminal" },
    h("rect", { x: "9", y: "11", width: "46", height: "41", rx: "5", stroke: "#91a0af", strokeOpacity: ".5" }),
    path("m17 23 9 8-9 8M32 41h12", { stroke: "#e5f5eb", strokeWidth: "3" }))];
  if (type === "calculator") return [h("g", { key: "calc" },
    h("rect", { x: "13", y: "9", width: "38", height: "46", rx: "6", fill: "#f4f0e8" }),
    h("rect", { x: "18", y: "14", width: "28", height: "10", rx: "2", fill: "#475951" }),
    ...[0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => h("rect", { key: `${row}-${column}`, x: 18 + column * 10, y: 29 + row * 8, width: "7", height: "5", rx: "1.5", fill: column === 2 ? "#f3993b" : "#a8b0ad" }))))];
  if (type === "activity") return [h("g", { key: "activity" },
    ...[18, 28, 38, 48].map((v) => path(`M10 ${v}h44M${v} 10v44`, { key: v, stroke: "#4f706a", strokeWidth: ".65" })),
    path("M9 35h10l5-16 9 29 6-21 5 8h11", { stroke: "#73f4a1", strokeWidth: "2.4" }))];
  if (type === "settings") return [h("g", { key: "settings" },
    h("circle", { cx: "32", cy: "32", r: "20", fill: "#657381", stroke: "#eff4f8", strokeWidth: "2" }),
    ...Array.from({ length: 12 }, (_, i) => h("path", { key: i, d: "M30 9h4l1 8h-6Z", fill: "#e2e8ed", transform: `rotate(${i * 30} 32 32)` })),
    h("circle", { cx: "32", cy: "32", r: "12", fill: "#ced8e1", stroke: "#eff4f8", strokeWidth: "2" }),
    h("circle", { cx: "32", cy: "32", r: "6", fill: "#697b8c", stroke: "#5a6774", strokeWidth: "1" }))];
  if (type === "portfolio") return [h("g", { key: "portfolio" },
    path("M24 23v-5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v5", { stroke: "#e7f4dc", strokeWidth: "3" }),
    h("rect", { x: "12", y: "23", width: "40", height: "29", rx: "5", fill: "#f4e5be" }),
    path("M13 34h38", { stroke: "#b09e73", strokeWidth: "1.5" }), h("rect", { x: "29", y: "31", width: "6", height: "7", rx: "1", fill: "#d5bd84" }))];
  if (["text", "file", "pdf", "image"].includes(type)) return [h("g", { key: "document" },
    h("path", { d: "M17 9h22l9 10v36H17Z", fill: "#fff", stroke: "#bcc7d3", strokeWidth: "1" }),
    h("path", { d: "M39 9v11h9", fill: "#e3eaf2", stroke: "#bcc7d3", strokeWidth: "1" }),
    type === "image" ? h("g", null, h("rect", { x: "22", y: "26", width: "21", height: "19", rx: "2", fill: "#d2edf8" }), h("path", { d: "m22 42 8-10 5 7 4-4 4 7", fill: "#77ae80" }))
      : type === "pdf" ? h("text", { x: "32", y: "40", textAnchor: "middle", fill: "#c84849", fontSize: "10", fontWeight: "700", fontFamily: "system-ui" }, "PDF")
      : h("g", null, ...[28, 33, 38, 43].map((y) => path(`M23 ${y}h18`, { key: y, stroke: "#90a3b5", strokeWidth: "1.5" }))))];
  if (type === "trash") return [h("g", { key: "trash" }, path("M19 21h26l-3 32H22ZM16 17h32M26 17v-5h12v5M28 26v20M36 26v20", { stroke: "#f4f7fa" }))];
  if (type === "home") return [h("g", { key: "home" }, path("m14 31 18-17 18 17M19 28v23h26V28M28 51V37h9v14", { stroke: "#fff" }))];
  return [h("g", { key: "app" }, h("rect", { x: "15", y: "14", width: "34", height: "36", rx: "5", stroke: "#fff", strokeWidth: "2" }), path("M15 24h34M22 19h1M27 19h1M23 33h18M23 40h12", { stroke: "#fff", strokeWidth: "2" }))];
}
