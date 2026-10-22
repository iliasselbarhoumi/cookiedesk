// Protected cookies (P1-1): bulk delete, imports and set restores leave them alone.
// Stored by identity (store, partition, domain, path, name), never a value.
// Regular-store protections persist in chrome.storage.local. Incognito ones live in
// chrome.storage.session (memory only), and the worker drops them when the
// incognito session ends, so nothing about an incognito session reaches disk.

import { cookieKey } from '../core/model.js';

export const PROTECTED_KEY = 'protected';
const LOCK = 'cookiedesk-protect';
const MAX = 10_000;

const areaFor = (storeId) => (storeId === '0' ? chrome.storage.local : chrome.storage.session);

async function read(area) {
  const { [PROTECTED_KEY]: list = [] } = await area.get(PROTECTED_KEY);
  return Array.isArray(list) ? list : [];
}

export async function loadProtected() {
  const [persistent, session] = await Promise.all([read(chrome.storage.local), read(chrome.storage.session)]);
  return new Set([...persistent, ...session]);
}

/** Read-modify-write under a Web Lock shared by popup, panel and worker, so no toggle is lost. */
export function setProtected(cookie, on) {
  const area = areaFor(cookie.storeId);
  const k = cookieKey(cookie);
  return navigator.locks.request(LOCK, async () => {
    const keys = new Set(await read(area));
    if (on) {
      if (!keys.has(k) && keys.size >= MAX) throw new Error(`You can protect up to ${MAX} cookies. Unprotect some first.`);
      keys.add(k);
    } else {
      keys.delete(k);
    }
    await area.set({ [PROTECTED_KEY]: [...keys] });
  });
}

export function onProtectedChanged(listener) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'local' || area === 'session') && PROTECTED_KEY in changes) listener();
  });
}
