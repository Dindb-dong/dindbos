import React from "react";

// Original artwork following Windows' layered, familiar app silhouettes.
const ARTWORK = {
  "files": "<path d=\"M5 17a4 4 0 0 1 4-4h17l6 7h23a4 4 0 0 1 4 4v28H5Z\" fill=\"#e9a600\"/><path d=\"M5 27h54l-5 26H9Z\" fill=\"#ffcf40\"/>",
  "browser": "<path d=\"M58 34C58 17 45 7 31 8 15 8 5 19 6 35c1 15 18 25 32 21 10-2 17-9 19-17-8 10-25 11-31 2-4-7 2-14 10-12 6 1 7 6 5 9 10 3 17-1 17-4Z\" fill=\"#087cd8\"/><path d=\"M6 35C4 13 30 1 47 12c7 4 11 11 11 22-6-12-22-19-35-11-5 3-6 7-5 13Z\" fill=\"#27c6b4\"/>",
  "portfolio": "<rect x=\"9\" y=\"13\" width=\"46\" height=\"43\" rx=\"3\" fill=\"#1869b4\"/><rect x=\"25\" y=\"7\" width=\"14\" height=\"8\" rx=\"3\" fill=\"#58b8ed\"/><rect x=\"15\" y=\"24\" width=\"34\" height=\"4\" rx=\"3\" fill=\"#d8edff\"/><rect x=\"15\" y=\"33\" width=\"25\" height=\"3\" rx=\"3\" fill=\"#d8edff\"/>",
  "terminal": "<rect x=\"5\" y=\"10\" width=\"54\" height=\"45\" rx=\"3\" fill=\"#252c35\"/><path d=\"m15 23 10 9-10 9 3 3 14-12-14-12Z\" fill=\"#f4f7fa\"/><rect x=\"33\" y=\"40\" width=\"15\" height=\"3\" rx=\"0\" fill=\"#76c8ee\"/>",
  "activity": "<rect x=\"8\" y=\"9\" width=\"48\" height=\"47\" rx=\"3\" fill=\"#eff4f9\"/><rect x=\"14\" y=\"35\" width=\"7\" height=\"15\" rx=\"3\" fill=\"#1685ce\"/><rect x=\"27\" y=\"25\" width=\"7\" height=\"25\" rx=\"3\" fill=\"#32a9ea\"/><rect x=\"40\" y=\"17\" width=\"7\" height=\"33\" rx=\"3\" fill=\"#0067c0\"/>",
  "text": "<rect x=\"12\" y=\"6\" width=\"40\" height=\"52\" rx=\"3\" fill=\"#dceeff\"/><rect x=\"18\" y=\"15\" width=\"30\" height=\"34\" rx=\"3\" fill=\"#fff\"/><rect x=\"18\" y=\"19\" width=\"26\" height=\"3\" rx=\"3\" fill=\"#69bce8\"/><rect x=\"18\" y=\"27\" width=\"26\" height=\"3\" rx=\"3\" fill=\"#69bce8\"/><rect x=\"18\" y=\"35\" width=\"21\" height=\"3\" rx=\"3\" fill=\"#69bce8\"/>",
  "pdf": "<path d=\"M14 5h25l13 13v40H14Z\" fill=\"#f6f5f3\"/><path d=\"M39 5v14h13Z\" fill=\"#c9cdd2\"/><rect x=\"6\" y=\"29\" width=\"45\" height=\"20\" rx=\"3\" fill=\"#cf302d\"/><path d=\"M14 34h6v10h-3v-3h-3Zm14 0h6v10h-6Zm14 0h8v3h-5v2h4v3h-4v2h-3Z\" fill=\"#fff\"/>",
  "applications": "<rect x=\"7\" y=\"10\" width=\"50\" height=\"45\" rx=\"3\" fill=\"#f4f6f9\"/><path d=\"M23 18v-5a9 9 0 0 1 18 0v5h-3v-5a6 6 0 0 0-12 0v5Z\" fill=\"#438bd1\"/><rect x=\"15\" y=\"27\" width=\"15\" height=\"15\" rx=\"0\" fill=\"#087bd8\"/><rect x=\"32\" y=\"27\" width=\"15\" height=\"15\" rx=\"0\" fill=\"#56bbef\"/>",
  "calculator": "<rect x=\"14\" y=\"5\" width=\"36\" height=\"54\" rx=\"3\" fill=\"#d4e7f8\"/><rect x=\"19\" y=\"11\" width=\"26\" height=\"12\" rx=\"3\" fill=\"#fff\"/><rect x=\"19\" y=\"28\" width=\"7\" height=\"7\" rx=\"1\" fill=\"#fff\"/><rect x=\"28\" y=\"28\" width=\"7\" height=\"7\" rx=\"1\" fill=\"#fff\"/><rect x=\"37\" y=\"28\" width=\"7\" height=\"7\" rx=\"1\" fill=\"#fff\"/><rect x=\"19\" y=\"37\" width=\"7\" height=\"7\" rx=\"1\" fill=\"#fff\"/><rect x=\"28\" y=\"37\" width=\"7\" height=\"7\" rx=\"1\" fill=\"#fff\"/><rect x=\"37\" y=\"37\" width=\"7\" height=\"7\" rx=\"1\" fill=\"#fff\"/><rect x=\"19\" y=\"46\" width=\"7\" height=\"7\" rx=\"1\" fill=\"#fff\"/><rect x=\"28\" y=\"46\" width=\"7\" height=\"7\" rx=\"1\" fill=\"#fff\"/><rect x=\"37\" y=\"46\" width=\"7\" height=\"7\" rx=\"1\" fill=\"#0067c0\"/>",
  "settings": "<path d=\"m28 5 8 0 2 8 6 3 8-2 4 7-6 6v8l6 6-4 7-8-2-6 3-2 8h-8l-2-8-6-3-8 2-4-7 6-6v-8l-6-6 4-7 8 2 6-3Z\" fill=\"#75899d\"/><circle cx=\"32\" cy=\"32\" r=\"10\" fill=\"#d9edf9\"/>",
  "notes": "<rect x=\"10\" y=\"8\" width=\"44\" height=\"48\" rx=\"3\" fill=\"#9a62c9\"/><rect x=\"19\" y=\"14\" width=\"31\" height=\"37\" rx=\"3\" fill=\"#f4eff9\"/><rect x=\"5\" y=\"15\" width=\"18\" height=\"35\" rx=\"3\" fill=\"#773aa6\"/><path d=\"M10 23h3l5 13V23h3v20h-3l-5-13v13h-3Z\" fill=\"#fff\"/>",
  "reminders": "<path d=\"m9 30 12 12L51 12l7 7-37 37L3 38Z\" fill=\"#1876c9\"/>",
  "calendar": "<rect x=\"8\" y=\"10\" width=\"48\" height=\"46\" rx=\"3\" fill=\"#e4effa\"/><rect x=\"8\" y=\"10\" width=\"48\" height=\"13\" rx=\"3\" fill=\"#1384ce\"/><rect x=\"13\" y=\"28\" width=\"38\" height=\"23\" rx=\"3\" fill=\"#fff\"/><path d=\"M24 32h4v15h-4Zm9 0h10v3h-6v3h5v3h-5v3h6v3H33Z\" fill=\"#1878c3\"/>",
  "clock": "<circle cx=\"32\" cy=\"32\" r=\"26\" fill=\"#d6e6f4\"/><circle cx=\"32\" cy=\"32\" r=\"22\" fill=\"#f8fbfe\"/><path d=\"M32 15v17l11 7\" fill=\"none\" stroke=\"#1869ad\" stroke-width=\"4\" stroke-linecap=\"round\"/>",
  "photos": "<rect x=\"6\" y=\"11\" width=\"52\" height=\"43\" rx=\"3\" fill=\"#087bd1\"/><rect x=\"11\" y=\"16\" width=\"42\" height=\"33\" rx=\"3\" fill=\"#73cff0\"/><path d=\"m11 48 14-17 9 10 6-6 13 13Z\" fill=\"#1465af\"/><circle cx=\"42\" cy=\"25\" r=\"5\" fill=\"#ffe29b\"/>",
  "music": "<rect x=\"7\" y=\"7\" width=\"50\" height=\"50\" rx=\"10\" fill=\"#ec6b27\"/><circle cx=\"32\" cy=\"32\" r=\"18\" fill=\"#fff\"/><path d=\"m28 22 15 10-15 10Z\" fill=\"#e96a25\"/>",
  "directory": "<path d=\"M5 17a4 4 0 0 1 4-4h17l6 7h23a4 4 0 0 1 4 4v28H5Z\" fill=\"#e9a600\"/><path d=\"M5 27h54l-5 26H9Z\" fill=\"#ffcf40\"/>",
  "folder": "<path d=\"M5 17a4 4 0 0 1 4-4h17l6 7h23a4 4 0 0 1 4 4v28H5Z\" fill=\"#e9a600\"/><path d=\"M5 27h54l-5 26H9Z\" fill=\"#ffcf40\"/>",
  "file": "<rect x=\"12\" y=\"6\" width=\"40\" height=\"52\" rx=\"3\" fill=\"#dceeff\"/><rect x=\"18\" y=\"15\" width=\"30\" height=\"34\" rx=\"3\" fill=\"#fff\"/><rect x=\"18\" y=\"19\" width=\"26\" height=\"3\" rx=\"3\" fill=\"#69bce8\"/><rect x=\"18\" y=\"27\" width=\"26\" height=\"3\" rx=\"3\" fill=\"#69bce8\"/><rect x=\"18\" y=\"35\" width=\"21\" height=\"3\" rx=\"3\" fill=\"#69bce8\"/>",
  "image": "<rect x=\"6\" y=\"11\" width=\"52\" height=\"43\" rx=\"3\" fill=\"#087bd1\"/><rect x=\"11\" y=\"16\" width=\"42\" height=\"33\" rx=\"3\" fill=\"#73cff0\"/><path d=\"m11 48 14-17 9 10 6-6 13 13Z\" fill=\"#1465af\"/><circle cx=\"42\" cy=\"25\" r=\"5\" fill=\"#ffe29b\"/>",
  "home": "<path d=\"m4 29 28-23 28 23-5 6-5-4v25H14V31l-5 4Z\" fill=\"#1e8dd4\"/><rect x=\"26\" y=\"38\" width=\"12\" height=\"18\" rx=\"0\" fill=\"#aee3ff\"/>",
  "trash": "<path d=\"M17 20h30l-3 37H20Z\" fill=\"#9aafbd\"/><rect x=\"12\" y=\"12\" width=\"40\" height=\"6\" rx=\"3\" fill=\"#c1d1dc\"/><rect x=\"25\" y=\"7\" width=\"14\" height=\"5\" rx=\"3\" fill=\"#7792a5\"/>"
};

export function renderWindowsIcon(type, id) {
  const name = type === "app" || type === "welcome" ? "applications" : type;
  const artwork = Object.hasOwn(ARTWORK, name) ? ARTWORK[name] : null;
  if (!artwork) return null;
  return React.createElement("svg", {
    className: "dos-app-icon", "data-icon-style": "windows",
    viewBox: "0 0 64 64", "aria-hidden": true,
    dangerouslySetInnerHTML: { __html: artwork },
  });
}
