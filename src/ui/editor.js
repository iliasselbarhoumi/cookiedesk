// The cookie editor: a view that replaces the list. Validation runs live with
// the same rules the engine enforces, so Save is only offered for a cookie Chrome
// will accept, and every refusal is explained next to its field.

import { h, icon } from './dom.js';
import { validateCookie } from '../core/validate.js';
import { isPublicSuffix } from '../core/site.js';
import { formFromCookie, draftFromForm, byteCount, defaultExpiry } from './view.js';

const MAX_BYTES = 4096;

// validate.js field -> the form control its issue sits next to.
const ISSUE_SLOT = { name: 'name', value: 'value', domain: 'domain', path: 'path', expirationDate: 'expires', secure: 'flags', httpOnly: 'flags', sameSite: 'flags', partitionKey: 'partition' };

function check(name, label, extra = {}) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', name, ...extra }), h('span', { text: label }));
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
  const domainIn = h('input', { name: 'domain', id: id('domain'), class: 'mono', autocomplete: 'off', spellcheck: false });
  const pathIn = h('input', { name: 'path', id: id('path'), class: 'mono', autocomplete: 'off', spellcheck: false });
  const expiresIn = h('input', { type: 'datetime-local', name: 'expires', id: id('expires'), step: 1, attrs: { 'aria-label': 'Expires' } });
  const sameSiteIn = h('select', { name: 'sameSite', id: id('sameSite') },
    h('option', { value: 'unspecified', text: 'Unspecified' }), h('option', { value: 'lax', text: 'Lax' }),
    h('option', { value: 'strict', text: 'Strict' }), h('option', { value: 'no_restriction', text: 'None' }));
  const topIn = h('input', { name: 'topLevelSite', id: id('topLevelSite'), class: 'mono', autocomplete: 'off', spellcheck: false, placeholder: 'https://example.com', attrs: { 'aria-label': 'Top-level site' } });
  const general = h('div', { class: 'issues general', dataset: { slot: 'general' } });
  const saveBtn = h('button', { type: 'submit', class: 'btn primary', testid: 'editor-save', text: cookie ? 'Save' : 'Add cookie' });

  const form = h('form', { class: 'editor', testid: 'editor', noValidate: true, attrs: { 'aria-label': cookie ? 'Edit cookie' : 'Add cookie' } },
    h('div', { class: 'editor-head' },
      h('button', { type: 'button', class: 'icon-btn', title: 'Back (Esc)', attrs: { 'aria-label': 'Back to the list' }, onclick: () => cancel() }, icon('back')),
      h('h2', { text: cookie ? 'Edit cookie' : 'Add cookie' }),
      cookie && h('span', { class: 'editor-sub mono', text: cookie.name })),
    h('div', { class: 'editor-body', testid: 'editor-issues' },
      general,
      field('name', 'Name', nameIn),
      field('value', 'Value', valueIn, bytes),
      h('div', { class: 'grid2' },
        field('domain', 'Domain', domainIn, check('hostOnly', 'Host-only (no Domain attribute)')),
        field('path', 'Path', pathIn)),
      field('expires', 'Expiry', h('div', { class: 'inline' }, check('session', 'Session cookie'), expiresIn)),
      field('flags', 'Attributes', h('div', { class: 'inline' },
        check('secure', 'Secure'), check('httpOnly', 'HttpOnly'),
        h('label', { class: 'select-label', htmlFor: id('sameSite') }, h('span', { text: 'SameSite' }), sameSiteIn))),
      field('partition', 'Partition',
        check('partitioned', 'Partitioned (CHIPS)', { disabled: !feats.partitionKey }),
        h('div', { class: 'partition-site' }, h('span', { class: 'hint', text: 'Top-level site' }), topIn),
        !feats.partitionKey && h('p', { class: 'hint', text: 'This version of Chrome can\'t write partitioned cookies.' }))),
    h('div', { class: 'editor-foot' },
      cookie && h('button', { type: 'button', class: 'btn danger-ghost', testid: 'editor-delete', onclick: () => remove(cookie) }, icon('trash'), 'Delete'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', testid: 'editor-cancel', text: 'Cancel', onclick: () => cancel() }),
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
    bytes.textContent = `${n} / ${MAX_BYTES} bytes`;
    bytes.classList.toggle('over', n > MAX_BYTES);

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
