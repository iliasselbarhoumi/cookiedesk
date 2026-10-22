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
const ICONS = {
  cookie: ['M12 3a9 9 0 1 0 9 9 3 3 0 0 1-3.5-3A3 3 0 0 1 14 5.5 3 3 0 0 1 12 3z', 'M8.5 10.5h.01', 'M15.5 15h.01', 'M10 16h.01', 'M12 12.5h.01'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  plus: ['M12 5v14', 'M5 12h14'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  back: ['M15 18l-6-6 6-6'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  lock: ['M6 11h12v9H6z', 'M9 11V8a3 3 0 0 1 6 0v3'],
  shield: ['M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z'],
  keyboard: ['M3 7h18v10H3z', 'M7 11h.01', 'M11 11h.01', 'M15 11h.01', 'M8 14h8'],
};

export function icon(name, cls = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
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
