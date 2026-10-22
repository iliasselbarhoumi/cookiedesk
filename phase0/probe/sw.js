// Probe only: record action clicks so run.mjs can test activeTab.
chrome.action.onClicked.addListener((tab) => {
  chrome.storage.session.set({ clicked: { tabId: tab.id, url: tab.url ?? null, at: Date.now() } });
});
