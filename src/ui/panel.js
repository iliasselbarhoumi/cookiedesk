// Entry point for the popup and the side panel (same component, spec §8 / P0-8).
// Every view state comes from resolveContext(); every write goes through the
// engine, which journals it for undo before touching Chrome.

import { h, $, byTestId } from './dom.js';
import { resolveContext, restrictedMessage } from './context.js';
import { createEngine } from '../core/cookies.js';
import * as perms from '../core/perms.js';
import { renderRows } from './list.js';
import { createEditor } from './editor.js';
import { createAccessView } from './access.js';
import { confirmDialog, showToast } from './dialogs.js';
import { exportCookies, importFile, copySnippet, saveSet, restoreSet } from './transfer.js';
import { filterCookies, countSummary, storeLabel, diffLists, describeChanges } from './view.js';
import { loadProtected, setProtected, onProtectedChanged } from './protect.js';
import { cookieKey } from '../core/model.js';

const isPopup = document.body.dataset.surface === 'popup';
const engine = createEngine();
const app = $('.app');
const main = $('.main');
const search = byTestId('search');
const storeSelect = byTestId('store-select');
const undoBtn = byTestId('undo-last');
const menu = $('#menu');

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
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---- the main view: a state message, or the list -------------------------------------

const listSection = h('section', { class: 'list-view' },
  h('div', { class: 'notes' }),
  h('ul', { class: 'rows', attrs: { 'aria-label': 'Cookies' } }),
  h('p', { class: 'empty', hidden: true }));
const rowsEl = $('.rows', listSection);
const messageSection = h('section', { class: 'message-view' });
main.append(messageSection, listSection);

const storeId = () => ui.storeId ?? ui.ctx?.storeId ?? '0';
const state = () => (ui.error ? { kind: 'error' } : ui.ctx?.state ?? { kind: 'loading' });

function siteTitle(st) {
  if (st.site) return st.site;
  if (st.kind === 'restricted') return 'Restricted page';
  return 'CookieDesk';
}

function messageFor(st) {
  const msg = (...parts) => h('p', { class: 'state-message', testid: 'state-message' }, ...parts);
  switch (st.kind) {
    case 'loading': return [msg('Loading…')];
    case 'unknown': return [msg('Click the CookieDesk button in the toolbar to show this tab\'s cookies.'),
      h('p', { class: 'hint', text: 'Chrome only tells CookieDesk which site a tab shows after you click its button, or for sites you\'ve allowed.' })];
    case 'restricted': return [msg(restrictedMessage(st.reason))];
    case 'error': return [msg('Something went wrong: ', ui.error)];
    case 'no-access': return [
      msg('CookieDesk doesn\'t have access to ', h('strong', { class: 'mono', text: st.site }), ' yet.'),
      // requestSite must be the first call in the handler: the prompt needs the click's user gesture.
      h('button', { type: 'button', class: 'btn primary grant', testid: 'grant-site', text: `Allow on ${st.site}`, onclick: () => perms.requestSite(st.site).then(scheduleRefresh, scheduleRefresh) }),
      h('p', { class: 'prompt-quote' }, h('span', { class: 'hint', text: 'Chrome will ask: ' }), h('q', { text: `Read and change your data on all ${st.site} sites` })),
      h('p', { class: 'hint', text: 'That lets CookieDesk read and edit this site\'s cookies, including its subdomains, and nothing else.' }),
      h('p', { class: 'hint' }, 'Rather not be asked per site? ', h('button', { type: 'button', class: 'link', text: 'Allow all sites in Access & settings', onclick: openAccess })),
    ];
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
  if (ui.live) notes.push(h('p', { class: 'note live', testid: 'live-activity', attrs: { role: 'status' }, text: `Just now: ${ui.live.text}` }));
  if (st.via === 'site') notes.push(h('p', { class: 'note', testid: 'note', dataset: { note: 'third-party' }, text: 'Cookies set by other sites embedded in this page are only shown for sites you\'ve allowed.' }));
  if (!engine.feats.partitionKey) notes.push(h('p', { class: 'note warn', testid: 'note', dataset: { note: 'no-partitions' }, text: 'Your version of Chrome can\'t show partitioned cookies, so this list may be incomplete.' }));
  const notesEl = $('.notes', listSection);
  if (notesEl.textContent !== notes.map((n) => n.textContent).join('')) notesEl.replaceChildren(...notes);

  const empty = $('.empty', listSection);
  empty.hidden = shown.length > 0;
  empty.textContent = ui.cookies.length ? `No cookies match “${search.value.trim()}”.` : `No cookies for ${st.site}.`;
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
  // Undoing an "Undid: X" entry re-applies X, so call it what it is.
  const redo = latest?.label.startsWith('Undid: ');
  // An entry left pending means the page closed mid-change: undo puts back what had been written.
  const text = !latest ? 'Undo' : redo ? `Redo: ${latest.label.slice(7)}` : `Undo${latest.interrupted ? ' interrupted' : ''}: ${latest.label}`;
  undoBtn.title = latest ? text : 'Nothing to undo';
  $('.undo-label', undoBtn).textContent = text;
}

// ---- mutations, toasts and undo ----------------------------------------------------------

/** Run a write; on irreversible / too_large_to_undo ask, then retry with allowIrreversible. */
async function mutate(fn) {
  const mine = (o) => { ui.selfUntil = Infinity; return fn(o).finally(() => { ui.selfUntil = Date.now() + 1500; }); };
  try {
    return await mine({});
  } catch (e) {
    if (e?.code !== 'irreversible' && e?.code !== 'too_large_to_undo') throw e;
    const ok = await confirmDialog({ title: 'This can\'t be undone', message: e.message, ok: 'Continue without undo', danger: true });
    return ok ? mine({ allowIrreversible: true }) : null;
  }
}

async function toastFor(result, text) {
  if (!result) return;
  let label = text;
  if (!label) label = (await engine.undoList({ storeId: storeId() })).find((x) => x.id === result.undoId)?.label ?? 'Done';
  showToast(label, { undo: result.undoId ? () => undo(result.undoId) : null });
}

async function undo(id) {
  let r;
  ui.selfUntil = Infinity;
  try {
    try {
      r = await engine.undo(id, { storeId: storeId() });
    } catch (e) {
      if (e?.code !== 'undo_conflict') throw e;
      if (!(await confirmDialog({ title: 'Undo anyway?', message: e.message, ok: 'Undo anyway', danger: true }))) return;
      r = await engine.undo(id, { force: true, storeId: storeId() });
    }
  } catch (e) {
    showToast(e?.message || String(e), { error: true });
    refreshUndo();
    return;
  } finally {
    ui.selfUntil = Date.now() + 1500;
  }
  const skipped = r.skipped.length ? ` Some cookies had already expired and weren't restored: ${r.skipped.join(', ')}.` : '';
  const refused = r.refused?.length ? ` Chrome no longer accepts these as they were, so they weren't restored: ${r.refused.join(', ')}.` : '';
  showToast(`Undone: ${r.label}.${skipped}${refused}`);
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
    showToast('Couldn\'t copy: the clipboard is not available here.', { error: true });
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
  showToast(on ? `Protected "${c.name}": bulk delete, import and set restore will leave it alone.` : `"${c.name}" is no longer protected.`);
}

const rowActions = {
  open: (c) => openEditor(c),
  copy: copyValue,
  protect: toggleProtected,
  remove: async (c) => {
    // Protection guards bulk operations; deleting one on purpose just asks first.
    if (isProtected(c) && !(await confirmDialog({ title: `Delete "${c.name}"?`, message: 'This cookie is protected. Delete it anyway? You can undo this.', ok: 'Delete', danger: true }))) return;
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
    await confirmDialog({ title: 'Nothing to delete', message: kept ? `All ${plural(kept, 'shown cookie')} are protected.` : 'No cookies are shown.', ok: 'OK', cancel: null });
    return;
  }
  const q = search.value.trim();
  const ok = await confirmDialog({
    title: `Delete ${plural(doomed.length, 'cookie')}?`,
    message: q ? `These cookies match "${q}" on ${state().site}. You can undo this.` : `Every cookie listed for ${state().site}. You can undo this.`,
    body: h('div', {},
      h('ul', { class: 'bullets scroll', testid: 'bulk-list' }, doomed.map((c) => h('li', {}, h('span', { class: 'mono', text: c.name || '(empty name)' }), h('span', { class: 'hint', text: ` · ${c.domain}${c.path}` })))),
      kept ? h('p', { class: 'hint', text: `${plural(kept, 'protected cookie')} will be kept.` }) : null),
    ok: `Delete ${plural(doomed.length, 'cookie')}`,
    danger: true,
  });
  if (ok) await deleteCookies(doomed);
}

function showShortcuts() {
  const keys = [
    ['/', 'Search'], ['↓ ↑', 'Move through the list'], ['Home End', 'First / last cookie'], ['Enter', 'Edit'],
    ['c', 'Copy value'], ['p', 'Protect / unprotect'], ['Del', 'Delete (undoable)'], ['n', 'Add a cookie'],
    ['⌘Z / Ctrl+Z', 'Undo'], ['Esc', 'Back, or clear the search'], ['?', 'This list'],
  ];
  confirmDialog({
    title: 'Keyboard shortcuts',
    message: '',
    body: h('dl', { class: 'keys', testid: 'shortcut-list' }, keys.flatMap(([k, what]) => [h('dt', {}, ...k.split(' ').map((x) => h('kbd', { text: x }))), h('dd', { text: what })])),
    ok: 'Close',
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
      const text = original && r.cookie ? `Saved "${draft.name}"` : null;
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
  menu.style.right = `${Math.max(8, document.documentElement.clientWidth - r.right)}px`;
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
        const kept = r?.skipped.length ? ` ${plural(r.skipped.length, 'protected cookie')} left as ${r.skipped.length === 1 ? 'it was' : 'they were'}: ${r.skipped.join(', ')}.` : '';
        if (r && !r.undoId) showToast(`Nothing to import: every cookie in the file is already set exactly like that.${kept}`);
        else if (r) showToast(`Imported ${plural(r.written, 'cookie')}.${kept}`, { undo: r.undoId ? () => undo(r.undoId) : null });
      } catch (err) {
        showToast(err?.message || String(err), { error: true });
      }
      scheduleRefresh();
    },
  });
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
        const r = await mutate((o) => engine.importDrafts(drafts, { ...opts, label: `Restored set "${name}"`, ...o }));
        if (r) showToast(`Restored "${name}": ${plural(r.written, 'cookie')} written, ${r.deleted} deleted.`, { undo: r.undoId ? () => undo(r.undoId) : null });
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
