// Tiny DOM builder. Text always goes in as text nodes or properties, never as
// markup: cookie names and values are attacker-controlled.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('button', { class: 'btn', testid: 'add-cookie', onclick }, 'Add')
 * Props: class, testid, text, dataset, on<event> handlers, `attrs` for anything
 * else set via setAttribute, and plain properties (value, checked, disabled…).
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue; // false is every flag's default
    if (k === 'class') el.className = v;
    else if (k === 'testid') el.dataset.testid = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'attrs') for (const [a, av] of Object.entries(v)) { if (av !== undefined && av !== null) el.setAttribute(a, av); }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el[k] = v;
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// 24×24 stroke icons (paths only, so they need no markup parsing).
const CIRCLE = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z';
const ICONS = {
  cookie: ['M12 3a9 9 0 1 0 9 9 3 3 0 0 1-3.5-3A3 3 0 0 1 14 5.5 3 3 0 0 1 12 3z', 'M8.5 10.5h.01', 'M15.5 15h.01', 'M10 16h.01', 'M12 12.5h.01'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  plus: ['M12 5v14', 'M5 12h14'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  back: ['M15 18l-6-6 6-6'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  lock: ['M6 11h12v9H6z', 'M9 11V8a3 3 0 0 1 6 0v3'],
  eyeOff: ['M3 3l18 18', 'M10.6 6.1A9 9 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.4 3', 'M6.5 7.6C4.3 9.1 3 12 3 12s4 6 9 6a8.5 8.5 0 0 0 4.3-1.2', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  shield: ['M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z'],
  keyboard: ['M3 7h18v10H3z', 'M7 11h.01', 'M11 11h.01', 'M15 11h.01', 'M8 14h8'],
  heart: ['M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z'],
  star: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z'],
  coffee: ['M4 9h13v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z', 'M17 10h1.5a2.5 2.5 0 0 1 0 5H17', 'M8 3v3', 'M12 3v3'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  upload: ['M12 15V4', 'M7 9l5-5 5 5', 'M5 20h14'],
  braces: ['M8 4H7a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h1', 'M16 4h1a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-1'],
  fileText: ['M14 3H6v18h12V7z', 'M14 3v4h4', 'M9 13h6', 'M9 17h6'],
  code: ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4'],
  bookmark: ['M6 3h12v18l-6-4-6 4z'],
  history: ['M3.5 12a8.5 8.5 0 1 0 2.5-6', 'M3 4v5h5', 'M12 8v4l3 2'],
  compare: ['M6 3v12', 'M18 9v12', 'M3 6l3-3 3 3', 'M15 18l3 3 3-3'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
  sliders: ['M4 7h9', 'M17 7h3', 'M15 5v4', 'M4 17h3', 'M11 17h9', 'M9 15v4'],
  panel: ['M4 4h16v16H4z', 'M15 4v16'],
  popup: ['M3 4h18', 'M7 4v10h10V4', 'M17 4l2-2'],
  globe: [CIRCLE, 'M3 12h18', 'M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9', 'M12 3c-2.5 2.6-3.6 5.6-3.6 9s1.1 6.4 3.6 9'],
  clock: [CIRCLE, 'M12 7v5l3 2'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  split: ['M4 5h6v14H4z', 'M14 5h6v14h-6z'],
  key: ['M8 20a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M10.8 13.2L20 4', 'M16 8l3 3', 'M18 6l2 2'],
  ruler: ['M3 17L17 3l4 4L7 21z', 'M7 13l2 2', 'M10 10l2 2', 'M13 7l2 2'],
  info: [CIRCLE, 'M12 11v6', 'M12 7.5h.01'],
  folder: ['M3 6h6l2 2h10v11H3z'],
  users: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2 21a7 7 0 0 1 14 0', 'M16 3.5a4 4 0 0 1 0 7', 'M22 21a7 7 0 0 0-4-6.3'],
  tag: ['M3 12V3h9l9 9-9 9z', 'M7.5 7.5h.01'],
  alert: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18h.01'],
  ban: [CIRCLE, 'M5.6 5.6l12.8 12.8'],
  pointer: ['M5 3l14 7-6 2-2 6z'],
  incognito: ['M3 11h18', 'M6 11l2-6h8l2 6', 'M7 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M10 16h4'],
  chevron: ['M6 9l6 6 6-6'],
  zap: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
};

export function icon(name, cls = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.dataset.icon = name;
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const byTestId = (id, root = document) => root.querySelector(`[data-testid="${id}"]`);
