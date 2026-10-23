// Entry point for the popup and the side panel (same component, spec §8 / P0-8).
// Every view state comes from resolveContext(); every write goes through the
// engine, which journals it for undo before touching Chrome.

import { h, icon, $, byTestId } from './dom.js';
import { resolveContext, restrictedMessage } from './context.js';
import { createEngine } from '../core/cookies.js';
import * as perms from '../core/perms.js';
import { renderRows } from './list.js';
import { createEditor } from './editor.js';
import { createAccessView } from './access.js';
import { confirmDialog, showToast, onErrorToast } from './dialogs.js';
import { exportCookies, importFile, copySnippet, saveSet, restoreSet } from './transfer.js';
import { filterCookies, countSummary, storeLabel, diffLists, describeChanges } from './view.js';
import { loadProtected, setProtected, onProtectedChanged } from './protect.js';
import { createCompareView, readSets } from './compare.js';
import { cookieKey } from '../core/model.js';
import { noteInstalled, noteOutcome, ratingPrompt, rateLater, openReviews, storePage } from './rating.js';
import { supportPrompt, getSupport, openKofi, dismissPrompt, markSupporter } from './support.js';
import { t, tn, localizeDom } from '../lib/i18n.js';

// First, so the static text is in the UI language before icons are added to it.
localizeDom();

const isPopup = document.body.dataset.surface === 'popup';
const engine = createEngine();
const app = $('.app');
const main = $('.main');
const search = byTestId('search');
const storeSelect = byTestId('store-select');
const undoBtn = byTestId('undo-last');
const menu = $('#menu');
for (const b of menu.querySelectorAll('[data-icon]')) b.prepend(icon(b.dataset.icon));

const ui = {
  ctx: null,
  cookies: [],
  error: null,
  storeId: null, // user's pick in the store selector; null = the tab's store
  view: 'main', // main | editor | access
  overlay: null, // the editor or access view element
  access: null,
  listScroll: 0,
  protected: new Set(), // P1-1: cookie keys (never values)
  fresh: new Map(), // P1-5: key -> 'added' | 'changed', consumed by the next render
  live: null, // P1-5: { text } describing what the site just changed
  selfUntil: 0, // changes before this time are CookieDesk's own, not the site's
};

const isProtected = (c) => ui.protected.has(cookieKey(c));

// ---- the main view: a state message, or the list -------------------------------------

const listSection = h('section', { class: 'list-view' },
  h('div', { class: 'notes' }),
  h('ul', { class: 'rows', attrs: { 'aria-label': t('cookies_list') } }),
  h('div', { class: 'empty', testid: 'empty', hidden: true }));
const rowsEl = $('.rows', listSection);
const messageSection = h('section', { class: 'message-view' });
main.append(messageSection, listSection);

const storeId = () => ui.storeId ?? ui.ctx?.storeId ?? '0';
const state = () => (ui.error ? { kind: 'error' } : ui.ctx?.state ?? { kind: 'loading' });

function siteTitle(st) {
  if (st.site) return st.site;
  if (st.kind === 'restricted') return t('restricted_page');
  return 'CookieDesk';
}

/** A state screen: a round glyph, one line that says it, and at most one action. */
function stateArt(name, kind = '') {
  return h('span', { class: `state-art ${kind}`, attrs: { 'aria-hidden': 'true' } }, icon(name));
}

function skeleton() {
  return h('div', { class: 'skeleton', attrs: { 'aria-hidden': 'true' } },
    Array.from({ length: 5 }, (_, i) => h('div', { class: 'sk-row', style: `--i:${i}` }, h('span', { class: 'sk sk-name' }), h('span', { class: 'sk sk-value' }), h('span', { class: 'sk sk-meta' }))));
}

function messageFor(st) {
  const msg = (...parts) => h('p', { class: 'state-message', testid: 'state-message' }, ...parts);
  switch (st.kind) {
    case 'loading': return [skeleton(), h('p', { class: 'sr-only', testid: 'state-message', text: t('loading') })];
    case 'unknown': return [stateArt('pointer'), msg(t('state_unknown')),
      h('p', { class: 'hint', text: t('state_unknown_hint') })];
    case 'restricted': return [stateArt('ban'), msg(restrictedMessage(st.reason))];
    case 'error': return [stateArt('alert', 'danger'), msg(t('state_error', ui.error))];
    case 'no-access': {
      // The site name sits inside the sentence, wherever the language puts it.
      const [before, after = ''] = t('state_no_access', '\u2063').split('\u2063');
      return [
        stateArt('lock', 'accent'),
        msg(before, h('strong', { class: 'mono', text: st.site }), after),
        // requestSite must be the first call in the handler: the prompt needs the click's user gesture.
        h('button', { type: 'button', class: 'btn primary grant', testid: 'grant-site', onclick: () => perms.requestSite(st.site).then(scheduleRefresh, scheduleRefresh) }, icon('key'), t('grant_site', st.site)),
        h('p', { class: 'prompt-quote' }, h('span', { class: 'hint', text: `${t('chrome_will_ask')} ` }), h('q', { text: t('prompt_site', st.site) })),
        h('p', { class: 'hint fine' }, `${t('only_this_site')} `, h('button', { type: 'button', class: 'link', text: t('allow_all_instead'), onclick: openAccess })),
      ];
    }
    default: return [];
  }
}

function render() {
  const st = state();
  app.dataset.state = st.kind;
  $('.site').textContent = siteTitle(st);
  const ready = st.kind === 'ready';
  for (const el of document.querySelectorAll('[data-needs=ready]')) el.disabled = !ready;
  byTestId('add-cookie').disabled = !ready;
  search.disabled = !ready;

  const stores = ui.ctx?.stores ?? [];
  storeSelect.hidden = !ready || stores.length <= 1;
  storeSelect.parentElement.hidden = storeSelect.hidden;
  byTestId('copy-store').hidden = stores.length <= 1;
  if (!storeSelect.hidden) {
    storeSelect.replaceChildren(...stores.map((s) => h('option', { value: s.id, text: storeLabel(s) })));
    storeSelect.value = storeId();
  }

  if (!ready) {
    byTestId('count').textContent = '';
    listSection.hidden = true;
    messageSection.hidden = ui.view !== 'main';
    messageSection.dataset.kind = st.kind;
    messageSection.replaceChildren(...messageFor(st));
    return;
  }
  messageSection.hidden = true;
  messageSection.replaceChildren();
  listSection.hidden = ui.view !== 'main';

  const shown = filterCookies(ui.cookies, search.value);
  byTestId('count').textContent = countSummary(ui.cookies, shown.length);
  renderRows(rowsEl, shown, { site: st.site, actions: rowActions, isProtected, fresh: ui.fresh });
  ui.fresh = new Map();

  const notes = [];
  const note = (props, glyph, text) => h('p', props, icon(glyph, 'icon note-icon'), h('span', { text }));
  if (ui.live) notes.push(note({ class: 'note live', testid: 'live-activity', attrs: { role: 'status' } }, 'zap', t('live_just_now', ui.live.text)));
  if (st.via === 'site') notes.push(note({ class: 'note', testid: 'note', dataset: { note: 'third-party' } }, 'users', t('note_third_party')));
  if (!engine.feats.partitionKey) notes.push(note({ class: 'note warn', testid: 'note', dataset: { note: 'no-partitions' } }, 'alert', t('note_no_partitions')));
  const notesEl = $('.notes', listSection);
  if (notesEl.textContent !== notes.map((n) => n.textContent).join('')) notesEl.replaceChildren(...notes);

  const empty = $('.empty', listSection);
  empty.hidden = shown.length > 0;
  const emptyText = ui.cookies.length ? t('empty_no_match', search.value.trim()) : t('empty_none', st.site);
  if (!empty.hidden && empty.dataset.text !== emptyText) {
    empty.dataset.text = emptyText;
    empty.replaceChildren(
      stateArt(ui.cookies.length ? 'search' : 'cookie'),
      h('span', { class: 'empty-text', text: emptyText }),
      ui.cookies.length
        ? h('button', { type: 'button', class: 'btn small', onclick: () => { search.value = ''; render(); search.focus(); } }, icon('x'), t('clear_search'))
        : h('button', { type: 'button', class: 'btn small', onclick: () => openEditor(null) }, icon('plus'), t('add_cookie')));
  }
  if (empty.hidden) delete empty.dataset.text;
  if (!asked) maybeAsk();
}

// ---- refreshing: follow the tab, the grants and the cookie store ------------------------

let seq = 0;
async function refresh() {
  const mine = ++seq;
  try {
    const ctx = await resolveContext();
    if (mine !== seq) return;
    const moved = ui.ctx && (ui.ctx.tab?.id !== ctx.tab?.id || ui.ctx.state.site !== ctx.state.site);
    if (moved) {
      ui.storeId = null;
      if (ui.view === 'editor') closeOverlay();
    }
    // A picked store can vanish (last incognito window closed); fall back to the
    // tab's store everywhere, not just for listing, so Add/Import never target it.
    if (ui.storeId && !ctx.stores.some((s) => s.id === ui.storeId)) ui.storeId = null;
    let cookies = [];
    const listStore = ui.storeId ?? ctx.storeId;
    if (ctx.state.kind === 'ready') {
      cookies = await engine.list({ site: ctx.state.site, storeId: listStore });
    }
    if (mine !== seq) return;
    noteChanges(ctx, cookies, listStore);
    ui.ctx = ctx;
    ui.cookies = cookies;
    ui.error = null;
  } catch (e) {
    if (mine !== seq) return;
    ui.error = e?.message || String(e);
  }
  render();
  refreshUndo();
}

// P1-5: compare with the previous listing of the same site and store, mark what
// changed, and say so when it wasn't CookieDesk's own doing.
let liveTimer = null;
function noteChanges(ctx, cookies, listStore) {
  const prev = ui.ctx;
  const same = prev?.state.kind === 'ready' && ctx.state.kind === 'ready' && prev.state.site === ctx.state.site
    && prev.tab?.id === ctx.tab?.id && ui.listedStore === listStore;
  ui.listedStore = listStore; // the store ui.cookies comes from
  if (!same) { ui.live = null; return; }
  const d = diffLists(ui.cookies, cookies, cookieKey);
  for (const c of d.added) ui.fresh.set(cookieKey(c), 'added');
  for (const c of d.changed) ui.fresh.set(cookieKey(c), 'changed');
  const text = describeChanges(d);
  if (!text || Date.now() < ui.selfUntil) return;
  ui.live = { text };
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { ui.live = null; render(); }, 10_000);
}

let timer = null;
function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 40);
}

async function refreshUndo() {
  let entries = [];
  try { entries = await engine.undoList({ storeId: storeId() }); } catch { /* storage unavailable: leave disabled */ }
  const latest = entries[0];
  undoBtn.disabled = !latest;
  if (latest && latest.id !== undoBtn._latest) pop(undoBtn);
  undoBtn._latest = latest?.id;
  // Undoing an "Undid: X" entry re-applies X, so call it what it is.
  // An entry left pending means the page closed mid-change: undo puts back what had been written.
  const text = !latest ? t('undo') : latest.undid ? t('redo_entry', latest.undid) : t(latest.interrupted ? 'undo_interrupted' : 'undo_entry', latest.label);
  undoBtn.title = latest ? text : t('undo_nothing');
  $('.undo-label', undoBtn).textContent = text;
}

// ---- mutations, toasts and undo ----------------------------------------------------------

/** Run a write; on irreversible / too_large_to_undo ask, then retry with allowIrreversible. */
async function mutate(fn) {
  const mine = (o) => {
    ui.selfUntil = Infinity;
    return fn(o).then((r) => { if (r) noteOutcome('win').catch(() => {}); return r; })
      .finally(() => { ui.selfUntil = Date.now() + 1500; });
  };
  try {
    return await mine({});
  } catch (e) {
    if (e?.code !== 'irreversible' && e?.code !== 'too_large_to_undo') throw e;
    const ok = await confirmDialog({ title: t('irreversible_title'), message: e.message, ok: t('continue_no_undo'), danger: true });
    return ok ? mine({ allowIrreversible: true }) : null;
  }
}

async function toastFor(result, text) {
  if (!result) return;
  let label = text;
  if (!label) label = (await engine.undoList({ storeId: storeId() })).find((x) => x.id === result.undoId)?.label ?? t('done');
  showToast(label, { undo: result.undoId ? () => undo(result.undoId) : null });
}

/** `store`: the cookie store the entry belongs to (a copy to another store is undone there). */
async function undo(id, store = storeId()) {
  let r;
  ui.selfUntil = Infinity;
  try {
    try {
      r = await engine.undo(id, { storeId: store });
    } catch (e) {
      if (e?.code !== 'undo_conflict') throw e;
      if (!(await confirmDialog({ title: t('undo_anyway_title'), message: e.message, ok: t('undo_anyway'), danger: true }))) return;
      r = await engine.undo(id, { force: true, storeId: store });
    }
  } catch (e) {
    showToast(e?.message || String(e), { error: true });
    refreshUndo();
    return;
  } finally {
    ui.selfUntil = Date.now() + 1500;
  }
  const skipped = r.skipped.length ? t('undo_skipped', r.skipped.join(', ')) : '';
  const refused = r.refused?.length ? t('undo_refused', r.refused.join(', ')) : '';
  showToast([t('undone', r.label), skipped, refused].filter(Boolean).join(' '));
  scheduleRefresh();
}

async function deleteCookies(list) {
  try {
    const r = await mutate((o) => engine.remove(list, o));
    await toastFor(r);
  } catch (e) {
    showToast(e?.message || String(e), { error: true });
  }
  scheduleRefresh();
}

// ---- rows ----------------------------------------------------------------------------------

async function copyValue(c, button) {
  try {
    await navigator.clipboard.writeText(c.value);
  } catch {
    showToast(t('clipboard_failed'), { error: true });
    return;
  }
  const row = button?.closest('.row') ?? rowsEl.querySelector(':focus');
  if (!row) return;
  row.classList.add('copied');
  clearTimeout(row._copiedTimer);
  row._copiedTimer = setTimeout(() => row.classList.remove('copied'), 1200);
}

async function toggleProtected(c, on) {
  try {
    await setProtected(c, on);
  } catch (e) {
    showToast(e?.message || String(e), { error: true });
    return;
  }
  ui.protected = await loadProtected();
  render();
  showToast(on ? t('protected_on', c.name) : t('protected_off', c.name));
}

const rowActions = {
  open: (c) => openEditor(c),
  copy: copyValue,
  protect: toggleProtected,
  remove: async (c) => {
    // Protection guards bulk operations; deleting one on purpose just asks first.
    if (isProtected(c) && !(await confirmDialog({ title: t('delete_named', c.name), message: t('delete_protected_message'), ok: t('btn_delete'), danger: true, glyph: 'shield' }))) return;
    // Keep keyboard focus in the list when the focused row goes away.
    const row = document.activeElement?.closest?.('.row');
    if (row?._cookie === c) (row.nextElementSibling ?? row.previousElementSibling)?.focus();
    deleteCookies([c]);
  },
};

/** P1-2: delete what the list shows (the search narrows it), never protected cookies. */
async function bulkDelete() {
  const shown = filterCookies(ui.cookies, search.value);
  const doomed = shown.filter((c) => !isProtected(c));
  const kept = shown.length - doomed.length;
  if (!doomed.length) {
    await confirmDialog({ title: t('nothing_to_delete'), message: kept ? tn('all_shown_protected', kept) : t('no_cookies_shown'), ok: t('btn_ok'), cancel: null });
    return;
  }
  const q = search.value.trim();
  const ok = await confirmDialog({
    glyph: 'trash',
    title: tn('bulk_title', doomed.length),
    message: q ? t('bulk_match', q, state().site) : t('bulk_all', state().site),
    body: h('div', {},
      h('ul', { class: 'bullets scroll', testid: 'bulk-list' }, doomed.map((c) => h('li', {}, h('span', { class: 'mono', text: c.name || t('empty_name') }), h('span', { class: 'hint', text: ` · ${c.domain}${c.path}` })))),
      kept ? h('p', { class: 'hint', text: tn('protected_kept', kept) }) : null),
    ok: tn('bulk_ok', doomed.length),
    danger: true,
  });
  if (ok) await deleteCookies(doomed);
}

/** P2-2: copy what the list shows into another cookie store (e.g. normal <-> incognito). */
async function copyToStore() {
  const shown = filterCookies(ui.cookies, search.value);
  const from = ui.listedStore ?? storeId();
  const targets = (ui.ctx?.stores ?? []).filter((s) => s.id !== from);
  if (!shown.length || !targets.length) return;
  const select = h('select', { testid: 'copy-target', attrs: { 'aria-label': t('copy_to') } }, targets.map((s) => h('option', { value: s.id, text: storeLabel(s) })));
  const diskNote = h('p', { class: 'hint' });
  const updateNote = () => {
    diskNote.textContent = select.value === '0'
      ? t('copy_to_default_note')
      : t('copy_to_incognito_note');
  };
  select.addEventListener('change', updateNote);
  updateNote();
  const ok = await confirmDialog({
    glyph: 'layers',
    title: tn('copy_title', shown.length),
    message: t('copy_from', storeLabel({ id: from })),
    body: h('div', {}, select, diskNote,
      h('ul', { class: 'bullets scroll', testid: 'copy-list' }, shown.map((c) => h('li', { class: 'mono', text: c.name || t('empty_name') }))),
      h('p', { class: 'hint', text: t('copy_replace_note') })),
    ok: t('btn_copy'),
  });
  if (!ok) return;
  const to = select.value;
  const label = storeLabel({ id: to });
  try {
    const r = await mutate((o) => engine.importDrafts(shown, { storeId: to, protect: isProtected, label: tn('label_copied', shown.length, label), ...o }));
    if (!r) return;
    const kept = r.skipped.length ? tn('copy_kept', r.skipped.length) : '';
    // The header Undo and Ctrl+Z work on the store shown here; the copy lives in the target store.
    const parts = r.undoId ? [tn('copy_done', r.written, label), kept, t('copy_undo_hint', label)] : [t('copy_nothing', label), kept];
    showToast(parts.filter(Boolean).join(' '), { undo: r.undoId ? () => undo(r.undoId, to) : null });
  } catch (e) {
    showToast(e?.message || String(e), { error: true });
  }
}

/** P2-1: compare one set with the site's cookies now, or two sets with each other. */
async function compareSets(files) {
  let sets;
  try {
    sets = await readSets(files);
  } catch (e) {
    await confirmDialog({ title: t('compare_cant'), message: e.message, ok: t('btn_ok'), cancel: null });
    return;
  }
  const site = state().site;
  const at = (s) => { const ms = Date.parse(s.meta.exportedAt ?? ''); return Number.isFinite(ms) ? ` (${new Date(ms).toLocaleString()})` : ''; };
  const [a, b] = sets;
  const view = b
    ? { before: a.drafts, after: b.drafts, beforeLabel: `"${a.name}"${at(a)}`, afterLabel: `"${b.name}"${at(b)}` }
    : { before: a.drafts, after: ui.cookies, beforeLabel: `"${a.name}"${at(a)}`, afterLabel: t('compare_now', site) };
  const other = sets.find((s) => s.meta.site && s.meta.site !== site);
  if (!b && other) view.note = t('compare_other_site', other.meta.site, site);
  const { el } = createCompareView({ ...view, close: closeOverlay });
  showOverlay('compare', el);
  byTestId('diff-close')?.focus();
}

function showShortcuts() {
  const keys = [
    ['/', t('key_search')], ['↓ ↑', t('key_move')], ['Home End', t('key_first_last')], ['Enter', t('key_edit')],
    ['c', t('key_copy')], ['p', t('key_protect')], ['Del', t('key_delete')], ['n', t('add_cookie')],
    ['⌘Z / Ctrl+Z', t('undo')], ['Esc', t('key_back')], ['?', t('key_help')],
  ];
  confirmDialog({
    glyph: 'keyboard',
    title: t('shortcuts_title'),
    message: '',
    body: h('dl', { class: 'keys', testid: 'shortcut-list' }, keys.flatMap(([k, what]) => [h('dt', {}, ...k.split(' ').map((x) => h('kbd', { text: x }))), h('dd', { text: what })])),
    ok: t('btn_close'),
    cancel: null,
  });
}

rowsEl.addEventListener('keydown', (e) => {
  const row = e.target.closest('.row');
  if (!row || e.target !== row || e.altKey || e.ctrlKey || e.metaKey) return;
  const c = row._cookie;
  if (e.key === 'Enter') openEditor(c);
  else if (e.key === 'Delete' || e.key === 'Backspace') rowActions.remove(c);
  else if (e.key === 'c') copyValue(c, row.querySelector('[data-testid=row-copy]'));
  else if (e.key === 'p') toggleProtected(c, !isProtected(c));
  else if (e.key === 'ArrowDown') row.nextElementSibling?.focus();
  else if (e.key === 'ArrowUp') (row.previousElementSibling ?? search).focus();
  else if (e.key === 'Home') rowsEl.firstElementChild?.focus();
  else if (e.key === 'End') rowsEl.lastElementChild?.focus();
  else return;
  e.preventDefault();
});

// ---- overlays: editor and access view -------------------------------------------------------

function showOverlay(view, el) {
  if (ui.view === 'main') ui.listScroll = main.scrollTop;
  ui.overlay?.remove();
  ui.view = view;
  ui.overlay = el;
  app.dataset.view = view;
  listSection.hidden = true;
  messageSection.hidden = true;
  main.append(el);
  main.scrollTop = 0;
}

function closeOverlay() {
  ui.overlay?.remove();
  ui.overlay = null;
  ui.access = null;
  ui.view = 'main';
  app.dataset.view = 'main';
  render();
  main.scrollTop = ui.listScroll;
  for (const el of [listSection, messageSection]) pop(el, 'back-in');
}

function openEditor(cookie) {
  const st = state();
  if (st.kind !== 'ready') return;
  const returnFocus = cookie ? document.activeElement : byTestId('add-cookie');
  const back = () => {
    closeOverlay();
    const key = returnFocus?._key;
    (key ? [...rowsEl.children].find((r) => r._key === key) : returnFocus)?.focus?.();
  };
  const editor = createEditor({
    cookie,
    host: st.host,
    site: st.site,
    https: !ui.ctx.url.startsWith('http:'),
    feats: engine.feats,
    cancel: back,
    save: async (original, draft) => {
      const r = await mutate((o) => engine.save(original, original ? draft : { ...draft, storeId: storeId() }, o));
      if (!r) return;
      back();
      const text = original && r.cookie ? t('label_saved', draft.name) : null;
      await toastFor(r.undoId ? r : null, text);
      scheduleRefresh();
    },
    remove: async (c) => {
      back();
      await deleteCookies([c]);
    },
  });
  showOverlay('editor', editor.form);
  editor.focus();
}

function openAccess() {
  try { if (menu.matches(':popover-open')) menu.hidePopover(); } catch { /* not open */ }
  const view = createAccessView({ close: closeOverlay });
  ui.access = view;
  showOverlay('access', view.el);
  view.refresh().then(() => byTestId('access-close')?.focus());
}

// ---- header, menu, search, keyboard -----------------------------------------------------------

search.addEventListener('input', () => render());
storeSelect.addEventListener('change', () => { ui.storeId = storeSelect.value; refresh(); });
undoBtn.addEventListener('click', () => undo());
byTestId('add-cookie').addEventListener('click', () => openEditor(null));

menu.addEventListener('toggle', (e) => {
  if (e.newState !== 'open') return;
  const r = byTestId('menu').getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  // The menu hangs from the ⋯ button's outer edge: the right in LTR, the left in RTL.
  if (document.documentElement.dir === 'rtl') menu.style.left = `${Math.max(8, r.left)}px`;
  else menu.style.right = `${Math.max(8, document.documentElement.clientWidth - r.right)}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
});
function menuAction(testid, fn) {
  byTestId(testid).addEventListener('click', (e) => {
    try { if (menu.matches(':popover-open')) menu.hidePopover(); } catch { /* not open */ }
    fn(e);
  });
}
menuAction('export-json', () => exportCookies('json', { list: ui.cookies, site: state().site, storeId: storeId() }));
menuAction('export-netscape', () => exportCookies('netscape', { list: ui.cookies, site: state().site, storeId: storeId() }));
menuAction('export-snippet', () => copySnippet({ list: ui.cookies, site: state().site }));
menuAction('import', () => byTestId('import-file').click());
menuAction('save-set', () => saveSet({ list: ui.cookies, site: state().site, storeId: storeId() }));
menuAction('restore-set', () => byTestId('restore-file').click());
menuAction('bulk-delete', bulkDelete);
menuAction('compare-set', () => byTestId('compare-file').click());
menuAction('copy-store', copyToStore);
menuAction('open-access', openAccess);
menuAction('shortcuts', showShortcuts);
if (isPopup) {
  menuAction('open-sidepanel', () => {
    // sidePanel.open needs the click's user gesture, so it is the first call. The
    // panel follows the active tab of its window by itself; no per-tab path needed.
    const windowId = ui.ctx?.tab?.windowId;
    chrome.sidePanel.open({ windowId }).then(() => window.close(), (e) => showToast(e?.message || String(e), { error: true }));
  });
} else {
  byTestId('open-sidepanel').remove();
}

byTestId('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  await importFile(file, {
    site: state().site,
    write: async (drafts) => {
      try {
        const r = await mutate((o) => engine.importDrafts(drafts, { storeId: storeId(), protect: isProtected, ...o }));
        const kept = r?.skipped.length ? tn('import_kept', r.skipped.length, r.skipped.join(', ')) : '';
        if (r && !r.undoId) showToast([t('import_nothing'), kept].filter(Boolean).join(' '));
        else if (r) showToast([tn('imported', r.written), kept].filter(Boolean).join(' '), { undo: r.undoId ? () => undo(r.undoId) : null });
      } catch (err) {
        showToast(err?.message || String(err), { error: true });
      }
      scheduleRefresh();
    },
  });
});

byTestId('compare-file').addEventListener('change', async (e) => {
  const files = [...(e.target.files ?? [])];
  e.target.value = '';
  if (files.length) await compareSets(files);
});

byTestId('restore-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  // The store the list was read from, so deletes (from that list) and writes never straddle a store switch.
  const opts = { storeId: ui.listedStore ?? storeId(), remove: ui.cookies, protect: isProtected };
  await restoreSet(file, {
    site: state().site,
    plan: (drafts, o) => engine.importDrafts(drafts, { ...opts, ...o }),
    write: async (drafts, name) => {
      try {
        const r = await mutate((o) => engine.importDrafts(drafts, { ...opts, label: t('label_restored', name), ...o }));
        if (r) showToast(tn('restored', r.written, name, r.deleted), { undo: r.undoId ? () => undo(r.undoId) : null });
      } catch (err) {
        showToast(err?.message || String(err), { error: true });
      }
      scheduleRefresh();
    },
  });
});

document.addEventListener('keydown', (e) => {
  if (byTestId('confirm').open) return; // the dialog handles its own keys
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  const plain = !e.altKey && !e.ctrlKey && !e.metaKey;
  if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey) && !e.shiftKey && !typing && ui.view === 'main' && !undoBtn.disabled) {
    e.preventDefault();
    undo();
  } else if (e.key === '?' && !typing && ui.view === 'main') {
    e.preventDefault();
    showShortcuts();
  } else if (e.key === 'n' && plain && !typing && ui.view === 'main' && state().kind === 'ready') {
    e.preventDefault();
    openEditor(null);
  } else if (e.key === 'Escape') {
    if (ui.view !== 'main') { e.preventDefault(); closeOverlay(); }
    else if (e.target === search && search.value) { search.value = ''; render(); e.preventDefault(); }
  } else if (e.key === '/' && !typing && ui.view === 'main' && !search.disabled) {
    e.preventDefault();
    search.focus();
    search.select();
  } else if (e.key === 'ArrowDown' && e.target === search) {
    e.preventDefault();
    rowsEl.firstElementChild?.focus();
  }
});

// ---- support & rating -------------------------------------------------------------------------
// One gentle card at a time, at the bottom of the list, only after real use (rating.js, support.js).

/** Replay a one-shot animation class. */
function pop(el, cls = 'pop') {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

const heart = byTestId('support-heart');
const rateItem = byTestId('menu-rate');
rateItem.hidden = !storePage();

function showSupporter(on) {
  heart.classList.toggle('supporter', on);
  heart.title = on ? t('supporter_title') : t('support_title');
}

function hideAsk(card) {
  if (!card?.isConnected) return;
  card.classList.add('leaving');
  delete card.dataset.testid;
  setTimeout(() => card.remove(), 200);
}

function askCard(testid, cls, glyph, text, actions) {
  const card = h('aside', { class: `ask ${cls}`, testid, attrs: { 'aria-label': text[0] } },
    glyph,
    h('p', { class: 'ask-text' }, h('strong', { text: text[0] }), text[1] ? h('span', { text: ` ${text[1]}` }) : null),
    h('div', { class: 'ask-actions' }, actions(() => hideAsk(card))));
  return card;
}

function rateCard() {
  const rate = (close) => () => { close(); openReviews().catch(() => {}); };
  return askCard('ask-rate', 'rate', null, [t('rate_title'), t('rate_text')], (close) => [
    h('span', { class: 'stars', attrs: { role: 'group', 'aria-label': t('rate_group') } },
      [1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: 'star', title: t('menu_rate'), attrs: { 'aria-label': tn('rate_stars', n) }, onclick: rate(close) }, icon('star')))),
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'btn small ghost', testid: 'ask-later', text: t('btn_later'), onclick: () => { close(); rateLater().catch(() => {}); } }),
  ]);
}

function supportCard(prompt) {
  const glyph = h('span', { class: 'ask-glyph' }, icon('coffee'));
  if (prompt.kind === 'confirm') {
    return askCard('ask-support', 'kofi', glyph, [t('kofi_confirm_title'), t('kofi_confirm_text')], (close) => [
      h('button', { type: 'button', class: 'btn small kofi-btn', testid: 'ask-yes', onclick: () => {
        markSupporter().catch(() => {});
        showSupporter(true);
        pop(heart, 'burst');
        close();
      } }, icon('heart'), t('kofi_yes')),
      h('button', { type: 'button', class: 'btn small ghost', testid: 'ask-later', text: t('kofi_not_yet'), onclick: () => { close(); dismissPrompt(prompt).catch(() => {}); } }),
    ]);
  }
  return askCard('ask-support', 'kofi', glyph, [tn('kofi_milestone', prompt.milestone), t('kofi_free')], (close) => [
    h('button', { type: 'button', class: 'btn small kofi-btn', testid: 'ask-kofi', onclick: () => { close(); openKofi(prompt).catch(() => {}); } }, icon('coffee'), t('buy_coffee')),
    h('button', { type: 'button', class: 'btn small ghost', testid: 'ask-later', text: t('btn_later'), onclick: () => { close(); dismissPrompt(prompt).catch(() => {}); } }),
  ]);
}

let asked = false;
/** Once per opening, after the list first shows: the rating card wins over the support card. */
async function maybeAsk() {
  asked = true;
  try {
    const r = await ratingPrompt();
    let card = r.show ? rateCard() : null;
    if (!card && !r.supportQuiet) {
      const { prompt } = await supportPrompt(r.wins);
      if (prompt) card = supportCard(prompt);
    }
    if (card && ui.view === 'main' && state().kind === 'ready') listSection.append(card);
  } catch { /* storage unavailable: no card */ }
}

heart.addEventListener('click', () => { pop(heart, 'burst'); openKofi().catch(() => {}); });
menuAction('menu-support', () => openKofi().catch(() => {}));
menuAction('menu-rate', () => openReviews().catch(() => {}));
getSupport().then((s) => showSupporter(s.supporter), () => {});
noteInstalled().catch(() => {});
onErrorToast(() => { noteOutcome('trouble').catch(() => {}); });

// ---- events --------------------------------------------------------------------------------------

engine.onChange(scheduleRefresh);
onProtectedChanged(async () => { ui.protected = await loadProtected(); render(); });
perms.onGrantsChanged(() => { scheduleRefresh(); ui.access?.refresh(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session') refreshUndo(); });
// Undo entries expire after 10 minutes; drop them (and their values) on time.
setInterval(() => { engine.pruneJournal().then(refreshUndo, () => {}); }, 30_000);

async function followTabs() {
  // The side panel follows the active tab of its own window. With ?tab=<id> (tests,
  // or a pinned tab) it starts there and keeps following that tab's window.
  const params = new URLSearchParams(location.search);
  let windowId = null;
  if (params.has('tab')) {
    try { windowId = (await chrome.tabs.get(Number(params.get('tab')))).windowId; } catch { /* closed */ }
  }
  if (windowId === null) windowId = (await chrome.windows.getCurrent()).id;
  chrome.tabs.onActivated.addListener((info) => {
    if (info.windowId !== windowId) return;
    if (params.has('tab')) {
      params.set('tab', String(info.tabId));
      history.replaceState(null, '', `?${params}`);
    }
    scheduleRefresh();
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === ui.ctx?.tab?.id && (info.status === 'complete' || info.url)) scheduleRefresh();
  });
  chrome.windows.onFocusChanged.addListener((id) => { if (id === windowId) scheduleRefresh(); });
  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'context-changed') scheduleRefresh(); });
}

if (isPopup) {
  // The toolbar click that opened us granted activeTab: an open side panel can now see this tab.
  chrome.runtime.sendMessage({ type: 'context-changed' }).catch(() => { /* no panel open */ });
} else {
  followTabs();
}

search.focus();
loadProtected().then((p) => { ui.protected = p; }, () => {}).finally(() => refresh().then(() => { if (!search.disabled) search.focus(); }));
