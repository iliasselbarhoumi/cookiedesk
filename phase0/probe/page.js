// Records cookie change events (names and metadata only, never values).
window.events = [];
chrome.cookies.onChanged.addListener(({ removed, cause, cookie }) => {
  window.events.push({
    t: performance.now(),
    removed,
    cause,
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    partitionKey: cookie.partitionKey ?? null,
    valueLength: cookie.value.length,
  });
});
