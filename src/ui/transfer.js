// Export (with the credential warning, P0-9) and import (parse, preview, then
// one all-or-nothing write).

import { h } from './dom.js';
import { exportJson, exportNetscape, parseImport } from '../core/io.js';
import { isPublicSuffix, registrableDomain } from '../core/site.js';
import { isPartitioned } from '../core/partition.js';
import * as perms from '../core/perms.js';
import { confirmDialog, alertDialog } from './dialogs.js';
import { exportFilename } from './view.js';

const EXPORT_WARNING = 'This file contains live session cookies. Anyone who has it can sign in as you on these sites. Treat it like a password and delete it when you\'re done.';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

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
    title: kind === 'json' ? `Export ${plural(n, 'cookie')} as JSON` : `Export ${plural(n, 'cookie')} as cookies.txt`,
    message: EXPORT_WARNING,
    body: h('div', {},
      h('p', { class: 'hint', text: `All ${plural(n, 'cookie')} listed for ${site} go into the file, including HttpOnly ones.` }),
      skipped ? h('p', { class: 'hint', text: `${plural(skipped, 'partitioned cookie')} left out: cookies.txt can't record partitions. Use JSON to keep them.` }) : null),
    ok: 'Export',
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
    return alertDialog(`This file is ${Math.ceil(file.size / 1_000_000)} MB. Cookie exports are far smaller; CookieDesk reads files up to 5 MB.`, 'Can\'t import this file. Nothing was changed.');
  }
  let text;
  try {
    text = await file.text();
  } catch {
    return alertDialog('The file could not be read.', 'Can\'t import this file');
  }
  const r = parseImport(text, { now: Date.now(), isPublicSuffix, pageSite: site });
  if (!r.ok) return alertDialog(r.error.message, 'Can\'t import this file. Nothing was changed.');

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
      h('p', { class: 'warn-text', text: `CookieDesk needs access to ${plural(missing.length, 'more site')} before it can write these cookies:` }),
      h('ul', { class: 'bullets' }, missing.map((s) => h('li', { class: 'access-line' },
        h('span', { class: 'mono', text: s }),
        // requestSite must be the first call: the prompt needs the click's user gesture.
        h('button', { type: 'button', class: 'btn small', text: `Allow on ${s}`, onclick: () => perms.requestSite(s).then(checkAccess, checkAccess) })))),
      h('p', { class: 'hint', text: 'Or allow all sites under Access & settings.' }),
    ] : []));
  }

  const siteLine = (s) => h('span', {}, h('span', { class: 'mono', text: s }), h('span', { class: 'hint', text: ` · ${plural(bySite.get(s), 'cookie')}` }));
  const body = h('div', { class: 'import-preview' },
    others.length ? h('div', { class: 'import-others', testid: 'import-others' },
      h('h3', { class: 'section-title warn-text', text: `Other sites (${others.length})` }),
      h('p', { class: 'warn-text', text: `This file also writes cookies for sites other than ${site}. A cookie planted on another site can sign you in to the wrong account there. Only continue if you expected these sites.` }),
      bulletList(others, siteLine),
      h('label', { class: 'check' }, othersBox, ` Also write cookies for ${plural(others.length, 'other site')}`)) : null,
    bySite.has(site) ? h('p', {}, siteLine(site)) : null,
    partitionSites.length ? h('p', { class: 'hint', text: `Partitioned under: ${partitionSites.join(', ')}` }) : null,
    r.warnings.length ? h('h3', { class: 'section-title', text: `Warnings (${r.warnings.length})` }) : null,
    r.warnings.length ? bulletList(r.warnings) : null,
    accessBox);
  const confirmed = confirmDialog({
    title: 'Import cookies',
    message: `Import ${plural(r.drafts.length, 'cookie')}? Cookies with the same name, domain and path are replaced. You can undo the whole import.`,
    body,
    ok: 'Import',
  });
  updateOk(); // disabled until the access check (and any other-sites consent) is done
  await checkAccess();
  if (await confirmed) await write(r.drafts);
}
