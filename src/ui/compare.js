// Compare cookie sets (P2-1): a saved set against the site's cookies now, or two
// set files against each other (older first). Read-only view.

import { h, icon } from './dom.js';
import { parseImport } from '../core/io.js';
import { isPublicSuffix } from '../core/site.js';
import { diffCookieSets } from '../core/diff.js';
import { truncate } from './view.js';
import { t, tn } from '../lib/i18n.js';

const PREVIEW = 60;

/** Read and parse up to two set files. Returns [{ name, drafts, meta }] or throws Error with a message for the user. */
export async function readSets(files) {
  if (files.length > 2) throw new Error(t('compare_too_many'));
  const out = [];
  for (const f of files) {
    if (f.size > 5_000_000) throw new Error(t('set_file_too_large', f.name));
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
    h('div', {}, h('span', { class: 'mono name-cell', text: c.name || t('empty_name') }), h('span', { class: 'hint', text: ` · ${c.domain}${c.path}` })),
    extra);
}

function changeLine({ before, after, fields }) {
  const parts = [h('div', { class: 'hint', text: t('compare_changed_fields', fields.join(', ')) })];
  if (fields.includes('value')) {
    parts.push(h('div', { class: 'diff-values' },
      h('span', { class: 'mono was', text: truncate(before.value, PREVIEW) || t('empty_short') }),
      h('span', { class: 'arrow', text: ' → ' }),
      h('span', { class: 'mono now', text: truncate(after.value, PREVIEW) || t('empty_short') })));
  }
  return line(after, parts);
}

function section(title, testid, items, render) {
  if (!items.length) return null;
  return h('section', { class: 'diff-section', testid },
    h('h3', { class: 'section-title', text: t('title_count', title, items.length) }),
    h('ul', { class: 'diff-list' }, items.map(render)));
}

/** Build the comparison view. `before`/`after`: cookie lists with labels. */
export function createCompareView({ before, after, beforeLabel, afterLabel, note, close }) {
  const d = diffCookieSets(before, after);
  const nothing = !d.added.length && !d.removed.length && !d.changed.length && !d.expiryOnly.length;
  const el = h('section', { class: 'access compare', testid: 'diff-view', attrs: { 'aria-label': t('compare_aria') } },
    h('div', { class: 'editor-head' },
      h('button', { type: 'button', class: 'icon-btn', testid: 'diff-close', title: t('back_esc'), attrs: { 'aria-label': t('back') }, onclick: () => close() }, icon('back')),
      h('h2', { text: t('tile_compare') })),
    h('div', { class: 'access-body' },
      h('p', { class: 'diff-sides' }, h('strong', { text: beforeLabel }), ' → ', h('strong', { text: afterLabel })),
      note ? h('p', { class: 'note warn', text: note }) : null,
      h('p', { class: 'hint', testid: 'diff-summary', text: nothing ? tn('diff_none', d.same) : t('diff_summary', d.added.length, d.removed.length, d.changed.length + d.expiryOnly.length, d.same) }),
      section(t('diff_added'), 'diff-added', d.added, (c) => line(c)),
      section(t('diff_removed'), 'diff-removed', d.removed, (c) => line(c)),
      section(t('diff_changed'), 'diff-changed', d.changed, changeLine),
      d.expiryOnly.length ? h('details', { class: 'diff-section', testid: 'diff-expiry' },
        h('summary', { text: t('diff_expiry_only', d.expiryOnly.length) }),
        h('ul', { class: 'diff-list' }, d.expiryOnly.map(changeLine))) : null));
  return { el, diff: d };
}
