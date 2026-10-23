// In-page confirm dialog and the toast. No alert/confirm/prompt: they block the
// popup and can't be styled or tested.

import { h, icon, byTestId } from './dom.js';
import { t } from '../lib/i18n.js';

const TOAST_MS = 8000;
let pending = null;

/**
 * Show the confirm dialog. Resolves true on OK, false on Cancel or Escape.
 * `body` is an optional extra node (import preview). `ok: null` hides Cancel (an alert).
 * `glyph`: an icon name for the dialog's badge (danger dialogs default to a warning).
 */
export function confirmDialog({ title = '', message, body = null, ok = t('btn_ok'), cancel = t('btn_cancel'), danger = false, glyph = null }) {
  const dialog = byTestId('confirm');
  if (pending) pending(false);
  dialog.querySelector('.dialog-title').textContent = title;
  dialog.querySelector('.dialog-title').hidden = !title;
  const badge = dialog.querySelector('.dialog-glyph');
  const name = glyph ?? (danger ? 'alert' : null);
  badge.replaceChildren(...(name ? [icon(name)] : []));
  badge.hidden = !name;
  badge.classList.toggle('danger', danger);
  byTestId('confirm-message', dialog).hidden = !message;
  byTestId('confirm-message', dialog).textContent = message;
  dialog.querySelector('.dialog-body').replaceChildren(...(body ? [body] : []));
  const okBtn = byTestId('confirm-ok', dialog);
  const cancelBtn = byTestId('confirm-cancel', dialog);
  okBtn.textContent = ok;
  okBtn.disabled = false;
  okBtn.classList.toggle('danger', danger);
  cancelBtn.textContent = cancel ?? '';
  cancelBtn.hidden = cancel === null;
  dialog.returnValue = '';
  if (dialog.open) dialog.close();
  dialog.showModal();
  (danger ? cancelBtn : okBtn).focus();
  return new Promise((resolve) => {
    const form = dialog.querySelector('form');
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      pending = null;
      form.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('close', onClose);
      resolve(v);
    };
    // The submit event fires inside the click itself. 'close' is queued as a task,
    // which Chrome can hold back while the page is in the background, so it is
    // only the fallback (Escape, or a close from code).
    const onSubmit = (e) => done(e.submitter?.value === 'ok');
    const onClose = () => done(dialog.returnValue === 'ok');
    pending = (v) => { done(v); dialog.close(); };
    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('close', onClose);
  });
}

export function alertDialog(message, title = '') {
  return confirmDialog({ title, message, ok: t('btn_ok'), cancel: null });
}

let onToastError = () => {};
/** panel.js counts errors the user saw (rating.js: never ask right after trouble). */
export function onErrorToast(fn) { onToastError = fn; }

/** Toast with an optional Undo action. Replaces any toast already showing. */
export function showToast(text, { undo = null, error = false } = {}) {
  for (const old of document.querySelectorAll('.toast')) old.remove();
  if (error) onToastError();
  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    // It stops being "the toast" at once, then slides away.
    delete toast.dataset.testid;
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160);
  };
  const hold = () => { clearTimeout(timer); toast.classList.add('held'); };
  const arm = () => {
    clearTimeout(timer);
    toast.classList.remove('held');
    // The bar under the toast shows the time left; it starts over with the timer.
    const bar = toast.querySelector('.toast-timer');
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = '';
    timer = setTimeout(dismiss, TOAST_MS);
  };
  const toast = h('div', { class: `toast${error ? ' error' : ''}`, testid: 'toast', attrs: { role: error ? 'alert' : 'status' } },
    h('span', { class: 'toast-glyph' }, icon(error ? 'alert' : undo ? 'check' : 'info')),
    h('span', { class: 'toast-text', text }),
    undo && h('button', { class: 'toast-undo', testid: 'toast-undo', type: 'button', onclick: () => { dismiss(); undo(); } }, icon('undo'), t('undo')),
    h('button', { class: 'toast-close', type: 'button', title: t('dismiss'), attrs: { 'aria-label': t('dismiss') }, onclick: dismiss }, icon('x')),
    h('span', { class: 'toast-timer', attrs: { 'aria-hidden': 'true' } }));
  toast.style.setProperty('--toast-ms', `${TOAST_MS}ms`);
  // Hovering or focusing the toast holds it, so the Undo button never vanishes under the pointer.
  toast.addEventListener('pointerenter', hold);
  toast.addEventListener('pointerleave', arm);
  toast.addEventListener('focusin', hold);
  toast.addEventListener('focusout', arm);
  document.querySelector('.app').append(toast);
  arm();
  return dismiss;
}
