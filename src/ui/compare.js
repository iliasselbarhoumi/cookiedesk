// Compare cookie sets (P2-1): a saved set against the site's cookies now, or two
// set files against each other (older first). Read-only view.

import { h, icon } from './dom.js';
import { parseImport } from '../core/io.js';
import { isPublicSuffix } from '../core/site.js';
import { diffCookieSets } from '../core/diff.js';
import { truncate } from './view.js';

const PREVIEW = 60;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Read and parse up to two set files. Returns [{ name, drafts, meta }] or throws Error with a message for the user. */
export async function readSets(files) {
  if (files.length > 2) throw new Error('Pick one set to compare with now, or two sets to compare with each other.');
  const out = [];
  for (const f of files) {
    if (f.size > 5_000_000) throw new Error(`${f.name} is too large to be a cookie set.`);
    const r = parseImport(await f.text(), { now: Date.now(), isPublicSuffix });
    if (!r.ok) throw new Error(`${f.name}: ${r.error.message}`);
    out.push({ name: r.meta.set || f.name.replace(/\.json$/i, ''), drafts: r.drafts, meta: r.meta });
  }
  // Two files: the older export is "before".
  const time = (s) => { const t = Date.parse(s.meta.exportedAt ?? ''); return Number.isFinite(t) ? t : 0; };
  out.sort((a, b) => time(a) - time(b));
  return out;
}

function line(c, extra) {
  return h('li', { class: 'diff-item', dataset: { name: c.name } },
    h('div', {}, h('span', { class: 'mono name-cell', text: c.name || '(empty name)' }), h('span', { class: 'hint', text: ` · ${c.domain}${c.path}` })),
    extra);
}

function changeLine({ before, after, fields }) {
  const parts = [h('div', { class: 'hint', text: `Changed: ${fields.join(', ')}` })];
  if (fields.includes('value')) {
    parts.push(h('div', { class: 'diff-values' },
      h('span', { class: 'mono was', text: truncate(before.value, PREVIEW) || '(empty)' }),
      h('span', { class: 'arrow', text: ' → ' }),
      h('span', { class: 'mono now', text: truncate(after.value, PREVIEW) || '(empty)' })));
  }
  return line(after, parts);
}

function section(title, testid, items, render) {
  if (!items.length) return null;
  return h('section', { class: 'diff-section', testid },
    h('h3', { class: 'section-title', text: `${title} (${items.length})` }),
    h('ul', { class: 'diff-list' }, items.map(render)));
}

/** Build the comparison view. `before`/`after`: cookie lists with labels. */
export function createCompareView({ before, after, beforeLabel, afterLabel, note, close }) {
  const d = diffCookieSets(before, after);
  const nothing = !d.added.length && !d.removed.length && !d.changed.length && !d.expiryOnly.length;
  const el = h('section', { class: 'access compare', testid: 'diff-view', attrs: { 'aria-label': 'Compare cookie sets' } },
    h('div', { class: 'editor-head' },
      h('button', { type: 'button', class: 'icon-btn', testid: 'diff-close', title: 'Back (Esc)', attrs: { 'aria-label': 'Back' }, onclick: () => close() }, icon('back')),
      h('h2', { text: 'Compare' })),
    h('div', { class: 'access-body' },
      h('p', { class: 'diff-sides' }, h('strong', { text: beforeLabel }), ' → ', h('strong', { text: afterLabel })),
      note ? h('p', { class: 'note warn', text: note }) : null,
      h('p', { class: 'hint', testid: 'diff-summary', text: nothing ? `No differences: ${plural(d.same, 'cookie')} identical.` : `${d.added.length} added, ${d.removed.length} removed, ${d.changed.length + d.expiryOnly.length} changed, ${d.same} unchanged.` }),
      section('Added', 'diff-added', d.added, (c) => line(c)),
      section('Removed', 'diff-removed', d.removed, (c) => line(c)),
      section('Changed', 'diff-changed', d.changed, changeLine),
      d.expiryOnly.length ? h('details', { class: 'diff-section', testid: 'diff-expiry' },
        h('summary', { text: `Only the expiry changed (${d.expiryOnly.length})` }),
        h('ul', { class: 'diff-list' }, d.expiryOnly.map(changeLine))) : null));
  return { el, diff: d };
}
