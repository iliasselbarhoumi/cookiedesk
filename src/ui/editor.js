// The cookie editor: a view that replaces the list. Validation runs live with
// the same rules the engine enforces, so Save is only offered for a cookie Chrome
// will accept, and every refusal is explained next to its field.

import { h, icon } from './dom.js';
import { validateCookie } from '../core/validate.js';
import { isPublicSuffix } from '../core/site.js';
import { formFromCookie, draftFromForm, byteCount, defaultExpiry } from './view.js';
import { explainCookie } from '../core/explain.js';
import { t } from '../lib/i18n.js';

const MAX_BYTES = 4096;

// validate.js field -> the form control its issue sits next to.
const ISSUE_SLOT = { name: 'name', value: 'value', domain: 'domain', path: 'path', expirationDate: 'expires', secure: 'flags', httpOnly: 'flags', sameSite: 'flags', partitionKey: 'partition' };

// Explanation topics (core/explain.js) -> their icon.
const TOPIC_ICONS = { 'third-party': 'users', prefix: 'tag', scope: 'globe', path: 'folder', secure: 'lock', httpOnly: 'eyeOff', sameSite: 'link', expiry: 'clock', partition: 'split', jwt: 'key', size: 'ruler' };

/** A checkbox drawn as a toggle chip; the real input stays in the form. */
function check(name, label, { glyph, title, ...extra } = {}) {
  return h('label', { class: 'check chip', title },
    h('input', { type: 'checkbox', name, ...extra }), glyph && icon(glyph, 'icon chip-icon'), h('span', { text: label }), icon('check', 'icon chip-tick'));
}

function field(slot, label, control, ...more) {
  return h('div', { class: `field f-${slot}`, dataset: { slot } },
    label && h('label', { class: 'label', text: label, htmlFor: control.id }),
    control, ...more,
    h('div', { class: 'issues', dataset: { slot } }));
}

/**
 * Build the editor. `cookie` null = Add. Callbacks return promises:
 *   save(original, draft) -> resolves when done (throws CookieError to show it here)
 *   remove(cookie), cancel()
 */
export function createEditor({ cookie, host, site, https, feats, save, remove, cancel }) {
  const now = () => Date.now();
  const initial = formFromCookie(cookie, { host, site, https });
  const id = (n) => `ed-${n}`;

  const nameIn = h('input', { name: 'name', id: id('name'), class: 'mono', autocomplete: 'off', spellcheck: false });
  const valueIn = h('textarea', { name: 'value', id: id('value'), class: 'mono', rows: 4, spellcheck: false, attrs: { wrap: 'soft' } });
  const bytes = h('span', { class: 'bytes', testid: 'byte-count' });
  const meterFill = h('span', { class: 'meter-fill' });
  const meter = h('div', { class: 'value-foot' }, h('span', { class: 'meter', attrs: { 'aria-hidden': 'true' } }, meterFill), bytes);
  const domainIn = h('input', { name: 'domain', id: id('domain'), class: 'mono', autocomplete: 'off', spellcheck: false });
  const pathIn = h('input', { name: 'path', id: id('path'), class: 'mono', autocomplete: 'off', spellcheck: false });
  const expiresIn = h('input', { type: 'datetime-local', name: 'expires', id: id('expires'), step: 1, attrs: { 'aria-label': t('field_expires') } });
  const sameSiteIn = h('select', { name: 'sameSite', id: id('sameSite') },
    h('option', { value: 'unspecified', text: t('samesite_unspecified') }), h('option', { value: 'lax', text: 'Lax' }),
    h('option', { value: 'strict', text: 'Strict' }), h('option', { value: 'no_restriction', text: 'None' }));
  const topIn = h('input', { name: 'topLevelSite', id: id('topLevelSite'), class: 'mono', autocomplete: 'off', spellcheck: false, placeholder: 'https://example.com', attrs: { 'aria-label': t('top_level_site') } });
  const general = h('div', { class: 'issues general', dataset: { slot: 'general' } });
  const saveBtn = h('button', { type: 'submit', class: 'btn primary', testid: 'editor-save' }, icon(cookie ? 'check' : 'plus'), cookie ? t('btn_save') : t('add_cookie_short'));

  const form = h('form', { class: 'editor', testid: 'editor', noValidate: true, attrs: { 'aria-label': cookie ? t('edit_cookie') : t('add_cookie_short') } },
    h('div', { class: 'editor-head' },
      h('button', { type: 'button', class: 'icon-btn', title: t('back_esc'), attrs: { 'aria-label': t('back_to_list') }, onclick: () => cancel() }, icon('back')),
      h('h2', { text: cookie ? t('edit_cookie') : t('add_cookie_short') }),
      cookie && h('span', { class: 'editor-sub mono', text: cookie.name })),
    h('div', { class: 'editor-body', testid: 'editor-issues' },
      general,
      // P2-3: what the cookie as stored does, in plain words. Read-only.
      cookie && h('details', { class: 'explain', testid: 'explain' },
        h('summary', {}, icon('info'), h('span', { text: t('explain_title') }), icon('chevron', 'icon chev')),
        h('ul', { class: 'explain-list' }, explainCookie(cookie, { site }).map((x) => h('li', { dataset: { topic: x.topic } },
          icon(TOPIC_ICONS[x.topic] ?? 'info', 'icon topic-icon'), h('span', { text: x.text }))))),
      field('name', t('field_name'), nameIn),
      field('value', t('field_value'), valueIn, meter),
      h('div', { class: 'grid2' },
        field('domain', t('field_domain'), domainIn, check('hostOnly', t('host_only'), { glyph: 'globe', title: t('host_only_title') })),
        field('path', t('field_path'), pathIn)),
      field('expires', t('field_expiry'), h('div', { class: 'inline' }, check('session', t('session'), { glyph: 'clock', title: t('session_title') }), expiresIn)),
      field('flags', t('field_attributes'), h('div', { class: 'inline' },
        check('secure', 'Secure', { glyph: 'lock', title: t('hint_secure') }),
        check('httpOnly', 'HttpOnly', { glyph: 'eyeOff', title: t('httponly_title') }),
        h('label', { class: 'select-label', htmlFor: id('sameSite') }, icon('link', 'icon chip-icon'), h('span', { text: 'SameSite' }), sameSiteIn))),
      field('partition', t('field_partition'),
        check('partitioned', t('partitioned_chips'), { glyph: 'split', disabled: !feats.partitionKey }),
        h('div', { class: 'partition-site' }, h('span', { class: 'hint', text: t('top_level_site') }), topIn),
        !feats.partitionKey && h('p', { class: 'hint', text: t('no_partition_write') }))),
    h('div', { class: 'editor-foot' },
      cookie && h('button', { type: 'button', class: 'icon-btn danger', testid: 'editor-delete', title: t('editor_delete_title'), attrs: { 'aria-label': t('btn_delete') }, onclick: () => remove(cookie) }, icon('trash')),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', testid: 'editor-cancel', text: t('btn_cancel'), onclick: () => cancel() }),
      saveBtn));

  const el = (n) => form.elements[n];
  for (const [k, v] of Object.entries(initial)) {
    if (el(k).type === 'checkbox') el(k).checked = v; else el(k).value = v;
  }

  function read() {
    const f = {};
    for (const k of Object.keys(initial)) f[k] = el(k).type === 'checkbox' ? el(k).checked : el(k).value;
    return f;
  }

  let errorsNow = 0;
  // A blank Add form is incomplete, not wrong: hold the issues until the user types.
  let touched = !!cookie;
  function update() {
    const f = read();
    expiresIn.disabled = f.session;
    form.querySelector('.partition-site').hidden = !f.partitioned;
    const n = byteCount(f.name, f.value);
    bytes.textContent = t('bytes_of', n, MAX_BYTES);
    bytes.classList.toggle('over', n > MAX_BYTES);
    meterFill.style.width = `${Math.min(100, (n / MAX_BYTES) * 100)}%`;
    meter.dataset.level = n > MAX_BYTES ? 'over' : n > MAX_BYTES * 0.8 ? 'high' : 'ok';

    const draft = draftFromForm(f, cookie);
    const { errors, warnings } = validateCookie(draft, { now: now(), isPublicSuffix, pageSite: site });
    for (const slot of form.querySelectorAll('.issues')) slot.replaceChildren();
    for (const [list, severity] of touched ? [[errors, 'error'], [warnings, 'warning']] : []) {
      for (const issue of list) {
        const slotName = ISSUE_SLOT[issue.field] ?? 'general';
        const slot = form.querySelector(`.issues[data-slot="${slotName}"]`) ?? general;
        slot.append(h('p', { class: `issue ${severity}`, text: issue.message, dataset: { code: issue.code, severity } }));
      }
    }
    for (const fl of form.querySelectorAll('.field')) {
      fl.classList.toggle('invalid', !!fl.querySelector(':scope > .issues .error'));
    }
    errorsNow = errors.length;
    saveBtn.disabled = errors.length > 0 || busy;
    return draft;
  }

  let busy = false;
  function setBusy(b) {
    busy = b;
    saveBtn.disabled = b || errorsNow > 0;
  }

  form.addEventListener('input', () => { touched = true; update(); });
  form.addEventListener('change', (e) => {
    touched = true;
    // Turning "Session" off needs a date; offer one instead of an instant error.
    if (e.target.name === 'session' && !e.target.checked && !expiresIn.value) expiresIn.value = defaultExpiry(now());
    update();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    touched = true;
    const draft = update();
    if (errorsNow || busy) return;
    setBusy(true);
    showError('');
    try {
      await save(cookie, draft);
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  });

  function showError(message) {
    form.querySelector('.save-error')?.remove();
    if (message) {
      general.after(h('p', { class: 'issue error save-error', text: message, attrs: { role: 'alert' } }));
      form.querySelector('.editor-body').scrollTop = 0;
    }
  }

  update();
  function focus() {
    if (!cookie) return nameIn.focus();
    // Start at the top of a long value (a JWT), not scrolled to its end.
    valueIn.focus({ preventScroll: true });
    valueIn.setSelectionRange(0, 0);
    valueIn.scrollTop = 0;
  }

  return { form, focus, showError };
}
