import React from 'react';

// Original artwork follows One UI's colorful squircle and simple semantic shapes.
const colors = {
  files: '#f5af32',
  browser: '#7254d5',
  portfolio: '#247bc7',
  terminal: '#293545',
  activity: '#39a782',
  text: '#5693d6',
  pdf: '#e85c63',
  applications: '#8365d8',
  calculator: '#58ad73',
  settings: '#7f8b99',
  notes: '#ef735b',
  reminders: '#9562db',
  calendar: '#4caf81',
  clock: '#7963ce',
  photos: '#e95d87',
  music: '#4e7fe3',
  folder: '#f5af32',
  directory: '#f5af32',
  file: '#5693d6',
  image: '#e95d87',
  home: '#4c91d4',
  trash: '#8895a5',
  app: '#8365d8',
  welcome: '#247bc7',
};
const glyphs = {
  files: [["path",{"d":"M13 23h15l5 6h18v20H13z","fill":"#fff"}]],
  browser: [["circle",{"cx":32,"cy":32,"r":13,"fill":"none","stroke":"#fff","strokeWidth":4}],["ellipse",{"cx":32,"cy":32,"rx":25,"ry":8,"transform":"rotate(-30 32 32)","fill":"none","stroke":"#fff","strokeWidth":3}]],
  portfolio: [["rect",{"x":13,"y":19,"width":38,"height":31,"rx":5,"fill":"#fff"}],["path",{"d":"M24 19v-6h16v6M13 31h38M28 31v7h8v-7","fill":"none","stroke":"#247bc7","strokeWidth":3}]],
  terminal: [["path",{"d":"m16 21 12 11-12 11m18 0h15","fill":"none","stroke":"#fff","strokeWidth":4,"strokeLinecap":"round","strokeLinejoin":"round"}]],
  activity: [["path",{"d":"M11 35h9l6-15 10 27 7-16h10","fill":"none","stroke":"#fff","strokeWidth":4,"strokeLinejoin":"round"}]],
  text: [["rect",{"x":17,"y":10,"width":30,"height":44,"rx":5,"fill":"#fff"}],["path",{"d":"M23 22h18M23 30h18M23 38h13","stroke":"#5693d6","strokeWidth":3}]],
  pdf: [["rect",{"x":17,"y":10,"width":30,"height":44,"rx":5,"fill":"#fff"}],["path",{"d":"m24 41 9-21 7 21m-13-7h11","fill":"none","stroke":"#e85c63","strokeWidth":3,"strokeLinejoin":"round"}]],
  applications: [["circle",{"cx":22,"cy":22,"r":7,"fill":"#fff"}],["circle",{"cx":42,"cy":22,"r":7,"fill":"#fff"}],["circle",{"cx":22,"cy":42,"r":7,"fill":"#fff"}],["circle",{"cx":42,"cy":42,"r":7,"fill":"#fff"}]],
  calculator: [["path",{"d":"M14 22h16m-8-8v16m15-8h14M15 39l13 13m0-13L15 52m23-9h13m-13 7h13","fill":"none","stroke":"#fff","strokeWidth":3.5,"strokeLinecap":"round"}]],
  settings: [["path",{"d":"m27 10 10 0 2 7 7 4 7-1 5 9-5 5-1 8 3 6-8 6-6-4-8 1-5 5-9-4 1-8-4-7-7-2V25l7-2 4-7z","fill":"#fff","transform":"translate(2 -1) scale(.9)"}],["circle",{"cx":32,"cy":32,"r":9,"fill":"#7f8b99"}]],
  notes: [["rect",{"x":16,"y":11,"width":32,"height":43,"rx":5,"fill":"#fff"}],["path",{"d":"M23 21h17M23 29h17M23 37h10","stroke":"#ef735b","strokeWidth":3}],["path",{"d":"m37 45 12-17 4 3-12 17-6 3z","fill":"#ffd6a3"}]],
  reminders: [["circle",{"cx":32,"cy":32,"r":20,"fill":"#fff"}],["path",{"d":"m21 32 8 8 15-18","fill":"none","stroke":"#9562db","strokeWidth":4,"strokeLinecap":"round","strokeLinejoin":"round"}]],
  calendar: [["rect",{"x":12,"y":15,"width":40,"height":38,"rx":6,"fill":"#fff"}],["path",{"d":"M13 26h38M23 11v9m18-9v9","stroke":"#c8f4db","strokeWidth":4}],["path",{"d":"M23 34h7v11m5-11h8l-7 11","fill":"none","stroke":"#4caf81","strokeWidth":3}]],
  clock: [["circle",{"cx":32,"cy":32,"r":22,"fill":"#fff"}],["path",{"d":"M32 17v16l11 7","fill":"none","stroke":"#7963ce","strokeWidth":4,"strokeLinecap":"round"}],["circle",{"cx":32,"cy":32,"r":3,"fill":"#7963ce"}]],
  photos: [["path",{"d":"M32 12c10-10 19 4 10 12 14-1 15 16 1 18 7 11-7 19-15 8-4 13-20 7-16-5-14-2-11-19 2-17-5-12 12-19 18-7z","fill":"#fff"}],["circle",{"cx":32,"cy":32,"r":7,"fill":"#e95d87"}]],
  music: [["path",{"d":"M27 42V19l22-5v24M27 25l22-5","fill":"none","stroke":"#fff","strokeWidth":5,"strokeLinejoin":"round"}],["ellipse",{"cx":21,"cy":44,"rx":8,"ry":6,"fill":"#fff"}],["ellipse",{"cx":43,"cy":40,"rx":8,"ry":6,"fill":"#fff"}]],
  home: [["path",{"d":"m11 30 21-18 21 18M18 27v25h28V27M28 52V37h9v15","fill":"none","stroke":"#fff","strokeWidth":4,"strokeLinejoin":"round"}]],
  trash: [["path",{"d":"M17 22h30M26 15h12M21 22l3 30h16l3-30M28 28v17m8-17v17","fill":"none","stroke":"#fff","strokeWidth":4,"strokeLinecap":"round","strokeLinejoin":"round"}]],
  folder: [["path",{"d":"M13 23h15l5 6h18v20H13z","fill":"#fff"}]],
  directory: [["path",{"d":"M13 23h15l5 6h18v20H13z","fill":"#fff"}]],
  file: [["rect",{"x":17,"y":10,"width":30,"height":44,"rx":5,"fill":"#fff"}],["path",{"d":"M23 22h18M23 30h18M23 38h13","stroke":"#5693d6","strokeWidth":3}]],
  image: [["path",{"d":"M32 12c10-10 19 4 10 12 14-1 15 16 1 18 7 11-7 19-15 8-4 13-20 7-16-5-14-2-11-19 2-17-5-12 12-19 18-7z","fill":"#fff"}],["circle",{"cx":32,"cy":32,"r":7,"fill":"#e95d87"}]],
  app: [["circle",{"cx":22,"cy":22,"r":7,"fill":"#fff"}],["circle",{"cx":42,"cy":22,"r":7,"fill":"#fff"}],["circle",{"cx":22,"cy":42,"r":7,"fill":"#fff"}],["circle",{"cx":42,"cy":42,"r":7,"fill":"#fff"}]],
  welcome: [["rect",{"x":13,"y":19,"width":38,"height":31,"rx":5,"fill":"#fff"}],["path",{"d":"M24 19v-6h16v6M13 31h38M28 31v7h8v-7","fill":"none","stroke":"#247bc7","strokeWidth":3}]],
};

export function renderAndroidIcon(type) {
  const shapes = Object.hasOwn(glyphs, type) ? glyphs[type] : null;
  if (!shapes) return null;
  return React.createElement('svg', { className: 'dos-app-icon', 'data-icon-style': 'android', viewBox: '0 0 64 64', 'aria-hidden': true, focusable: false },
    React.createElement('rect', { x: 1, y: 1, width: 62, height: 62, rx: 17, fill: colors[type] }),
    ...shapes.map(([tag, props], index) => React.createElement(tag, { ...props, key: index })));
}
