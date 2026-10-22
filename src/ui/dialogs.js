// In-page confirm dialog and the toast. No alert/confirm/prompt: they block the
// popup and can't be styled or tested.

import { h, byTestId } from './dom.js';

const TOAST_MS = 8000;
let pending = null;

/**
 * Show the confirm dialog. Resolves true on OK, false on Cancel or Escape.
 * `body` is an optional extra node (import preview). `ok: null` hides Cancel (an alert).
 */
export function confirmDialog({ title = '', message, body = null, ok = 'OK', cancel = 'Cancel', danger = false }) {
  const dialog = byTestId('confirm');
  if (pending) pending(false);
  dialog.querySelector('.dialog-title').textContent = title;
  dialog.querySelector('.dialog-title').hidden = !title;
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
    const done = (v) => {
      pending = null;
      dialog.removeEventListener('close', onClose);
      resolve(v);
    };
    const onClose = () => done(dialog.returnValue === 'ok');
    pending = (v) => { dialog.close(); done(v); };
    dialog.addEventListener('close', onClose);
  });
}

export function alertDialog(message, title = '') {
  return confirmDialog({ title, message, ok: 'OK', cancel: null });
}

/** Toast with an optional Undo action. Replaces any toast already showing. */
export function showToast(text, { undo = null, error = false } = {}) {
  document.querySelector('.toast')?.remove();
  let timer = null;
  const dismiss = () => { clearTimeout(timer); toast.remove(); };
  const arm = () => { clearTimeout(timer); timer = setTimeout(dismiss, TOAST_MS); };
  const toast = h('div', { class: `toast${error ? ' error' : ''}`, testid: 'toast', attrs: { role: error ? 'alert' : 'status' } },
    h('span', { class: 'toast-text', text }),
    undo && h('button', { class: 'toast-undo', testid: 'toast-undo', type: 'button', text: 'Undo', onclick: () => { dismiss(); undo(); } }),
    h('button', { class: 'toast-close', type: 'button', text: '×', attrs: { 'aria-label': 'Dismiss' }, onclick: dismiss }));
  // Hovering or focusing the toast holds it, so the Undo button never vanishes under the pointer.
  toast.addEventListener('pointerenter', () => clearTimeout(timer));
  toast.addEventListener('pointerleave', arm);
  toast.addEventListener('focusin', () => clearTimeout(timer));
  toast.addEventListener('focusout', arm);
  document.querySelector('.app').append(toast);
  arm();
  return dismiss;
}
