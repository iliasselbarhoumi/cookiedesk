// Service worker. Deliberately stateless: Chrome kills it at will. Settings live
// in chrome.storage.local, the undo journal in chrome.storage.session. It holds
// no cookie data and makes no network requests.

import { createEngine } from '../core/cookies.js';

// The user chooses what the toolbar button opens (P-5: never force the side panel).
const SURFACE_KEY = 'surface'; // 'popup' (default) | 'sidepanel'

async function applySurface() {
  const { [SURFACE_KEY]: surface = 'popup' } = await chrome.storage.local.get(SURFACE_KEY);
  const panel = surface === 'sidepanel';
  await chrome.action.setPopup({ popup: panel ? '' : 'src/popup/popup.html' });
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: panel });
}

chrome.runtime.onInstalled.addListener(applySurface);
chrome.runtime.onStartup.addListener(applySurface);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && SURFACE_KEY in changes) applySurface();
});

// Undo copies of incognito cookies must not outlive the incognito session.
// Don't rely on the store list having caught up when the window closes: if no
// incognito window is left, only the regular store ('0') is live.
async function pruneDeadStores() {
  const incognitoOpen = (await chrome.windows.getAll()).some((w) => w.incognito);
  const stores = (await chrome.cookies.getAllCookieStores()).map((s) => s.id);
  await createEngine().pruneJournal({ liveStores: incognitoOpen ? stores : stores.filter((id) => id === '0') });
}
chrome.windows.onRemoved.addListener(pruneDeadStores);
// Any wake-up is a chance to drop expired undo copies (there is no timer without the alarms permission).
chrome.runtime.onStartup.addListener(pruneDeadStores);
chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') pruneDeadStores(); });
