// Export (with the credential warning, P0-9) and import (parse, preview, then
// one all-or-nothing write).

import { h } from './dom.js';
import { exportJson, exportNetscape, exportDocumentCookie, parseImport } from '../core/io.js';
import { isPublicSuffix, registrableDomain, domainMatchesSite } from '../core/site.js';
import { isPartitioned } from '../core/partition.js';
import * as perms from '../core/perms.js';
import { confirmDialog, alertDialog, showToast } from './dialogs.js';
import { exportFilename, setFilename } from './view.js';
import { t, tn } from '../lib/i18n.js';


function download(text, filename, type) {
  // No downloads permission: a blob URL and <a download> stay inside the page.
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** `list` is everything listed for the site, not the search-filtered subset. */
export async function exportCookies(kind, { list, site, storeId }) {
  const skipped = kind === 'netscape' ? list.filter(isPartitioned).length : 0;
  const n = list.length - skipped;
  const ok = await confirmDialog({
    glyph: 'download',
    title: tn(kind === 'json' ? 'export_json' : 'export_txt', n),
    message: t('export_warning'),
    body: h('div', {},
      h('p', { class: 'hint', text: tn('export_all', n, site) }),
      skipped ? h('p', { class: 'hint', text: tn('export_partitioned_left', skipped) }) : null),
    ok: t('btn_export'),
  });
  if (!ok) return;
  const now = Date.now();
  if (kind === 'json') download(exportJson(list, { site, storeId, now }), exportFilename(site, 'json', now), 'application/json');
  else download(exportNetscape(list), exportFilename(site, 'txt', now), 'text/plain');
}

function bulletList(items, render = (x) => x) {
  // Never truncated: an import must not be able to hide where it writes (the list scrolls instead).
  return h('ul', { class: 'bullets scroll' }, items.map((x) => h('li', {}, render(x))));
}

const MAX_FILE_BYTES = 5_000_000; // same limit io.parseImport enforces; checked before reading

/**
 * Read a file, preview it, and import on confirmation.
 * `write(drafts)` performs the import (the caller handles undo toasts and retries).
 */
export async function importFile(file, { site, write }) {
  if (file.size > MAX_FILE_BYTES) {
    return alertDialog(t('import_too_big', Math.ceil(file.size / 1_000_000)), t('cant_import_unchanged'));
  }
  let text;
  try {
    text = await file.text();
  } catch {
    return alertDialog(t('file_unreadable'), t('cant_import'));
  }
  const r = parseImport(text, { now: Date.now(), isPublicSuffix, pageSite: site });
  if (!r.ok) return alertDialog(r.error.message, t('cant_import_unchanged'));

  // Every site the file writes to, by registrable domain, with the current site last.
  const bySite = new Map();
  for (const d of r.drafts) {
    const s = registrableDomain(d.domain);
    bySite.set(s, (bySite.get(s) ?? 0) + 1);
  }
  const sites = [...bySite.keys()].sort();
  const others = sites.filter((s) => s !== site);
  const partitionSites = [...new Set(r.drafts.filter(isPartitioned).map((d) => d.partitionKey.topLevelSite))].sort();

  let accessOk = false;
  const accessBox = h('div', { class: 'import-access' });
  const othersBox = others.length ? h('input', { type: 'checkbox', testid: 'import-other-sites' }) : null;
  const okButton = () => document.querySelector('[data-testid=confirm-ok]');
  const updateOk = () => {
    const btn = okButton();
    if (btn) btn.disabled = !accessOk || (othersBox && !othersBox.checked);
  };
  othersBox?.addEventListener('change', updateOk);

  async function checkAccess() {
    accessOk = false;
    updateOk();
    const missing = [];
    for (const s of sites) if (!(await perms.siteAccess(s)).granted) missing.push(s);
    accessOk = missing.length === 0;
    updateOk();
    accessBox.replaceChildren(...(missing.length ? [
      h('p', { class: 'warn-text', text: tn('needs_access', missing.length) }),
      h('ul', { class: 'bullets' }, missing.map((s) => h('li', { class: 'access-line' },
        h('span', { class: 'mono', text: s }),
        // requestSite must be the first call: the prompt needs the click's user gesture.
        h('button', { type: 'button', class: 'btn small', text: t('grant_site', s), onclick: () => perms.requestSite(s).then(checkAccess, checkAccess) })))),
      h('p', { class: 'hint', text: t('import_allow_all_hint') }),
    ] : []));
  }

  const siteLine = (s) => h('span', {}, h('span', { class: 'mono', text: s }), h('span', { class: 'hint', text: ` · ${tn('count_cookies', bySite.get(s))}` }));
  const body = h('div', { class: 'import-preview' },
    others.length ? h('div', { class: 'import-others', testid: 'import-others' },
      h('h3', { class: 'section-title warn-text', text: t('other_sites', others.length) }),
      h('p', { class: 'warn-text', text: t('other_sites_warning', site) }),
      bulletList(others, siteLine),
      h('label', { class: 'check' }, othersBox, ` ${tn('also_write', others.length)}`)) : null,
    bySite.has(site) ? h('p', {}, siteLine(site)) : null,
    partitionSites.length ? h('p', { class: 'hint', text: t('partitioned_under_list', partitionSites.join(', ')) }) : null,
    r.warnings.length ? h('h3', { class: 'section-title', text: t('warnings_count', r.warnings.length) }) : null,
    r.warnings.length ? bulletList(r.warnings) : null,
    accessBox);
  const confirmed = confirmDialog({
    glyph: 'upload',
    title: t('import_title'),
    message: tn('import_message', r.drafts.length),
    body,
    ok: t('tile_import'),
  });
  updateOk(); // disabled until the access check (and any other-sites consent) is done
  await checkAccess();
  if (await confirmed) await write(r.drafts);
}

// ---- P1-6: document.cookie snippet -------------------------------------------------------

/** Copy a document.cookie snippet for `list` to the clipboard, after the credential warning. */
export async function copySnippet({ list, site }) {
  const { text, skipped } = exportDocumentCookie(list, { site });
  const n = list.length - skipped.length;
  const ok = await confirmDialog({
    glyph: 'code',
    title: tn('snippet_title', n),
    message: t('snippet_warning'),
    body: h('div', {},
      h('p', { class: 'hint', text: t('snippet_paste', site) }),
      skipped.length ? h('p', { class: 'hint', text: tn('snippet_httponly_left', skipped.length) }) : null),
    ok: t('btn_copy'),
  });
  if (!ok) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast(tn('snippet_copied', n));
  } catch {
    showToast(t('clipboard_failed'), { error: true });
  }
}

// ---- P1-3: cookie sets, kept as files (nothing is stored in the extension) ------------------

/** Save the site's cookies as a named set file, after the credential warning. */
export async function saveSet({ list, site, storeId }) {
  const name = h('input', { type: 'text', class: 'set-name', testid: 'set-name', maxLength: 60, placeholder: t('set_name_placeholder'), attrs: { 'aria-label': t('set_name') } });
  const ok = await confirmDialog({
    glyph: 'bookmark',
    title: tn('save_set_title', list.length),
    message: t('export_warning'),
    body: h('div', {},
      h('label', { class: 'hint', text: t('field_name') }), name,
      h('p', { class: 'hint', text: t('set_file_note', site) })),
    ok: t('tile_save_set'),
  });
  if (!ok) return;
  const setName = name.value.trim() || t('default_set_name');
  download(exportJson(list, { site, storeId, now: Date.now(), setName }), setFilename(setName, site), 'application/json');
}

/** A cookie belongs to `site` if its domain is on it, or it is partitioned under it. */
function onSite(d, site) {
  if (domainMatchesSite(d.domain, site)) return true;
  try { return registrableDomain(new URL(d.partitionKey?.topLevelSite ?? '').hostname) === site; } catch { return false; }
}

/**
 * Restore a set file: the site's cookies become the set's. Shows exactly what will be
 * written, deleted and left alone (a dry run of the real transaction) before asking.
 * `plan(drafts, { dryRun })` runs engine.importDrafts with remove + protect.
 */
export async function restoreSet(file, { site, plan, write }) {
  if (file.size > MAX_FILE_BYTES) return alertDialog(t('set_too_large'), t('cant_restore_unchanged'));
  let text;
  try { text = await file.text(); } catch { return alertDialog(t('file_unreadable'), t('cant_restore')); }
  const r = parseImport(text, { now: Date.now(), isPublicSuffix, pageSite: site });
  if (!r.ok) return alertDialog(r.error.message, t('cant_restore_unchanged'));
  if (r.meta.site && r.meta.site !== site) {
    return alertDialog(t('wrong_site_message', r.meta.site), t('wrong_site_title'));
  }
  const foreign = r.drafts.filter((d) => !onSite(d, site));
  if (foreign.length) {
    return alertDialog(tn('foreign_cookies', foreign.length, [...new Set(foreign.map((d) => d.domain.replace(/^\./, '')))].slice(0, 3).join(', '), site), t('cant_restore_unchanged'));
  }

  let preview;
  try {
    preview = await plan(r.drafts, { dryRun: true });
  } catch (e) {
    return alertDialog(e?.message || String(e), t('cant_restore_unchanged'));
  }
  const setName = r.meta.set || file.name.replace(/\.json$/i, '');
  const section = (title, names, testid) => (names.length ? [h('p', { class: 'plan-head', text: t('title_count', title, names.length) }), h('ul', { class: 'bullets scroll', testid }, names.map((n) => h('li', { class: 'mono', text: n || t('empty_name') })))] : []);
  const nothing = !preview.plan.write.length && !preview.plan.delete.length;
  const ok = await confirmDialog({
    glyph: 'history',
    title: t('restore_title', setName),
    message: nothing
      ? t('restore_nothing', site)
      : tn('restore_message', r.drafts.length, site),
    body: h('div', { testid: 'restore-plan' },
      ...section(t('plan_write'), preview.plan.write, 'restore-write'),
      ...section(t('plan_delete'), preview.plan.delete, 'restore-delete'),
      ...section(t('plan_protected'), preview.skipped, 'restore-skipped')),
    ok: nothing ? t('btn_ok') : t('tile_restore'),
    cancel: nothing ? null : t('btn_cancel'),
    danger: preview.plan.delete.length > 0,
  });
  if (ok && !nothing) await write(r.drafts, setName);
}
