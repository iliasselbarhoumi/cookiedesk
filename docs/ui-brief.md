# Phase 2 UI brief

One component, rendered in the popup and the side panel (spec §8, P0-8). Read
first: `BUILD_SPEC_COOKIE.md` §3, §6, §8; `phase0/FINDINGS.md`; `docs/core-contract.md`
(engine API, error codes); `src/ui/context.js` (tab → view state, already written).

## Files

- `src/ui/panel.html` is the side panel and loads `panel.css` and `panel.js` (type=module).
- `src/popup/popup.html` is a thin host. It has the same markup and the same CSS/JS
  (`../ui/…`), with `<body data-surface="popup">`. Only the popup shows "Open in side panel".
- `src/ui/panel.js` is the entry point and wiring. Split it into modules under
  `src/ui/` where that helps, for example `list.js`, `editor.js`, `access.js`,
  `dialogs.js`, `transfer.js` (import/export).
- **Pure helpers in `src/ui/view.js`, unit-tested in `test/unit/view.test.mjs`:**
  - `filterCookies(list, query)`: live, case-insensitive, over name, value and domain.
  - `formatExpiry(cookie, now)`: "Session", "in 3 days", "Expired".
  - `byteCount`.
  - `truncate`.
  - `draftFromForm` / `formFromCookie`: converting between the editor form and a draft, including `datetime-local` ⇄ `expirationDate` (seconds, local time zone).
  - `countSummary(list)`: "23 cookies · 2 partitioned".

## Hard rules

- **Cookie values are attacker-controlled.** Render every cookie field with
  `textContent` or `value`, never `innerHTML` or string-built HTML. No inline
  scripts or handlers, because MV3 CSP forbids them anyway.
- **No network:** system font stack only, no remote anything. **No
  `console.log`** (the guard test fails). Never log, persist or put a cookie
  value in a URL.
- **No `alert`, `confirm` or `prompt`.** Use an in-page `<dialog>` for confirmations.
- **No banners, no rating nag, no upsell.**
- **`perms.requestSite()` / `requestAllSites()` must be the first await in the
  click handler**, because the user gesture is lost otherwise. `chrome.sidePanel.open({ windowId })`
  has the same constraint.
- **Plain ES modules, no build step, no dependencies.** Match the style of
  `src/core`: 2-space indent, single quotes, semicolons, sparse comments that
  explain *why*.

## Behaviour

**Views.** Driven by `resolveContext()` → `state.kind`:

- **loading**
- **unknown**: "Click the CookieDesk button in the toolbar to show this tab's cookies."
  This only occurs in the side panel on an ungranted site.
- **restricted**: `restrictedMessage(reason)`.
- **no-access**: "CookieDesk doesn't have access to **example.com** yet." Then a
  primary button "Allow on example.com", and below it the exact prompt Chrome will
  show: *Read and change your data on all example.com sites*. Add one line on what
  that allows (reading and editing this site's cookies, nothing else) and a link to
  the Access view for "all sites".
- **ready**: the list. If the list is empty: "No cookies for example.com." When
  `via === 'site'`, always show a quiet note: "Cookies set by other sites embedded
  in this page are only shown for sites you've allowed." When
  `!engine.feats.partitionKey`: "Your version of Chrome can't show partitioned
  cookies, so this list may be incomplete." (spec §5.3.5).
- **error**: with the message.

**Refresh.** The side panel must follow the user's tab:
- `chrome.tabs.onActivated`, `chrome.tabs.onUpdated` (status `complete`), and
  `chrome.windows.onFocusChanged`. Ignore events for other windows.
- `chrome.permissions.onAdded/onRemoved` (`perms.onGrantsChanged`).
- `engine.onChange` re-lists (debounced by the engine).
- A runtime message `{ type: 'context-changed' }` that the popup sends on open.
  The popup's click grants activeTab, so the panel can now see the URL.

The popup re-resolves on those too, but needs no tab following. Keep the search
query and scroll position across re-renders, and don't re-render rows that didn't
change, so the list doesn't flicker (test 6).

**List** (the list is the product: dense, scannable):
- **Header:** the site, `countSummary`, a search box focused on open (`/` also
  focuses it), an "Add" button, an undo button showing the latest `engine.undoList()`
  label (disabled when empty), and a menu with Export JSON, Export cookies.txt,
  Import…, Access & settings, and (popup only) Open in side panel.
- **Store selector:** shown only when `stores.length > 1`, labelled "Incognito" for
  the store that isn't `'0'`, otherwise by id.
- **Each row:** the name (bold, monospace), the value (monospace, one line, ellipsis,
  never breaks the layout, even with 4 KB JWTs), the domain and path (muted), and
  badges:
  - `HttpOnly`, with tooltip and accessible label "Not visible to page JavaScript"
    (call this out: it's why people come)
  - `Secure`
  - `Session`, or the expiry from `formatExpiry`
  - `SameSite=…` when not `unspecified`
  - `Partitioned`, with `partitionLabel(pk, site)` as tooltip and visible text when
    the row is wide enough
- **Row actions:** copy value (one click, shows "Copied"), delete (no confirm,
  because it's undoable; toast with Undo).
- Clicking the row or pressing Enter opens the editor. Use the engine's sort order.

**Editor** (a view that replaces the list in the popup and works the same in the
panel; Escape or Cancel goes back):
- **Fields:** name, value (textarea, monospace, byte counter "n / 4096 bytes" over
  name+value, turns red over the limit), domain plus a "Host-only (no Domain
  attribute)" checkbox, path, "Session cookie" checkbox, otherwise a
  `datetime-local` expiry, Secure, HttpOnly, SameSite select (Unspecified / Lax /
  Strict / None), and "Partitioned (CHIPS)" checkbox plus top-level site input
  (default `https://<site>`).
- **Validation:** run `validateCookie(draft, { now, isPublicSuffix, pageSite })` live.
  Errors appear next to their field (`issue.field`) and disable Save. Warnings show
  but allow Save. The `expired_deletes` warning reads plainly: "Saving with an expiry
  in the past deletes this cookie." (test 9).
- **Save:** `engine.save(original, draft)`, then return to the list with toast
  "Saved "name" · Undo". Show engine errors (`CookieError.message`) in the editor.
  On `irreversible` / `too_large_to_undo`, open a confirm dialog with the message
  and, on OK, retry with `{ allowIrreversible: true }`.
- **Add** opens the editor with defaults: domain = tab host, host-only, path `/`,
  Secure on for https, SameSite Lax, session.
- **Delete** button in the editor.

**Undo.**
- Every mutation shows a toast with the engine's label and an Undo button for about 8 s.
- The header undo button undoes the newest journal entry at any time, even after the popup
  was closed and reopened.
- `undo_conflict` opens the confirm dialog with the engine message; OK retries with `{ force: true }`.
- After undo, toast "Undone: label". Add "Some cookies had already expired and weren't
  restored: …" when `skipped.length`.

**Export** (P0-9):
- A confirm dialog first, saying plainly: "This file contains live session cookies.
  Anyone who has it can sign in as you on these sites. Treat it like a password and
  delete it when you're done."
- Then `io.exportJson(list, { site, storeId, now })` or `io.exportNetscape(list)`,
  downloaded via `Blob` + `URL.createObjectURL` + `<a download>`. No downloads permission.
- Filename: `cookies-<site>-<YYYYMMDD-HHmm>.json` or `.txt`.
- Export what's listed, not the search-filtered subset. Say in the dialog how many cookies.

**Import:**
- A hidden `<input type=file accept=".json,.txt">` feeds `io.parseImport(text, { now, isPublicSuffix, pageSite: site })`.
- On `ok:false`, show `error.message` in a dialog. Nothing is written.
- On ok, show a preview dialog: the count, the domains, the warnings. Check
  `perms.siteAccess(registrableDomain(d))` for each domain and list the ones without
  access (with an "Allow" button per site, or tell them to allow all sites).
- Confirm runs `engine.importDrafts(drafts, { storeId })`, then toast with Undo.

**Access & settings view:**
- Explain in plain words what a grant means.
- "All sites" section: when not granted, the button "Allow on all sites", and the exact
  prompt text *Read and change all your data on all websites*, with one honest sentence
  on why someone might want it (no per-site prompts, and third-party cookies on every
  page become visible). When granted, the button "Turn off all-sites access".
- List of granted sites (`perms.grants()`): site plus a "Remove" button for each (revoke).
  When all-sites is on, say per-site entries don't matter while it's on.
- **Setting** "Toolbar button opens: Popup / Side panel". It is stored in
  `chrome.storage.local` key `surface` (`'popup' | 'sidepanel'`); `sw.js` applies it.
- "Delete all cookies for this site" is buried here (P1-2 later; not now).
- One line: CookieDesk makes no network requests and stores no cookie values. The undo
  copy lives in memory for 10 minutes. Add a link to the source repository placeholder
  `https://github.com/` (an anchor only; nothing is fetched).

**Side panel button (popup only):** `chrome.sidePanel.open({ windowId: tab.windowId })`
as the first await in the click handler, then pass the tab as `?tab=<id>` via
`chrome.sidePanel.setOptions({ tabId, path: 'src/ui/panel.html?tab=<id>' })`
*before* `open`. Check whether a synchronous call order is needed and keep the
gesture. Then `window.close()`.

## Look and feel

- A developer tool: compact and information-dense, but calm.
- Popup width 420–480 px, height up to 580 px. The side panel is fluid.
- System UI font, monospace for names and values.
- Light and dark via `prefers-color-scheme`, with colours as CSS variables on `:root`.
- Respect `prefers-reduced-motion`.
- Visible `:focus-visible` rings.
- Full keyboard operation: Tab order is sane; rows are focusable; Enter opens; Delete
  key on a focused row deletes (undoable); `c` copies the focused row's value; Escape
  closes the editor or dialog; `/` focuses search.
- Badges are small pills with muted colours. `HttpOnly` and `Partitioned` get
  distinct, colour-blind-safe treatments, and the text always carries the meaning.
- No logos fetched. A simple inline SVG cookie glyph in the header is fine.

## DOM contract (e2e tests depend on these `data-testid`s; keep them exact)

```
state            element with data-state = loading|unknown|restricted|no-access|ready|error
state-message    explanation text for non-ready states
grant-site       "Allow on <site>" button (no-access state)
note             each note, with data-note = third-party|no-partitions
search           search input
count            countSummary text
cookie-row       each row; data-name, data-domain, data-path, data-partitioned="true|false"
badge-httponly / badge-secure / badge-session / badge-partitioned / badge-samesite   inside rows
row-copy / row-delete                                         inside rows
add-cookie / undo-last / menu (button opening the menu)
export-json / export-netscape / import / import-file (the input) / open-access / open-sidepanel
store-select
editor           editor root; form fields use name= name,value,domain,hostOnly,path,session,expires,secure,httpOnly,sameSite,partitioned,topLevelSite
editor-issues    container; each issue element has data-code and data-severity=error|warning
editor-save / editor-cancel / editor-delete / byte-count
toast / toast-undo
confirm / confirm-message / confirm-ok / confirm-cancel
access-view / access-close / grant-all / revoke-all / grant-row (data-site) / revoke (inside grant-row) / setting-surface (select)
```
