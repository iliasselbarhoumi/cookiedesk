# CookieDesk

CookieDesk is a cookie editor for Chrome (Manifest V3). It lists, searches, edits, adds, deletes, imports and exports the cookies of the site you are on, including partitioned (CHIPS) cookies, in a popup or a side panel. It asks for access one site at a time, makes no network requests, and lets you undo every change.

Not affiliated with Cookie-Editor or EditThisCookie.

This document is written so you can check each claim yourself. Where a claim rests on measured Chrome behaviour, it points to `phase0/FINDINGS.md`.

## Install

1. Open `chrome://extensions` and turn on Developer mode.
2. Choose Load unpacked and select the repository root (the folder that contains `manifest.json`).

Minimum Chrome version: 119 (see [Feature detection](#feature-detection) for why). There is no build step and the extension has no dependencies. `package.json` holds dev scripts only. `npm run build` zips the shippable files (`manifest.json`, `src/`, `icons/`) into `dist/`.

## Permissions

Installing shows no permission warnings (Chrome reports an empty warning list for this manifest).

| Permission | Why |
|---|---|
| `cookies` | The API itself. On its own it grants no access to any site and has no warning. |
| `storage` | `chrome.storage.local` for one setting (what the toolbar button opens). `chrome.storage.session` for the in-memory undo journal. |
| `activeTab` | After a toolbar click, the popup can read the active tab's URL, so it can name the site and offer the right grant. It grants no cookie access: in testing, `cookies.getAll` still returned `[]` and `set` still threw (FINDINGS §1). |
| `sidePanel` | Required by Chrome for the side panel surface. |
| `optional_host_permissions: ["<all_urls>"]` | Requested at runtime only, never at install. Used for the per-site grant and the opt-in "Allow on all sites". |

There is no `tabs`, `scripting`, `webNavigation` or `alarms` permission and no content scripts.

### The per-site grant

Without a grant, `getAll` returns `[]` silently and `set`/`remove` throw. CookieDesk shows an explicit "access not granted" state with a grant button, never a bare empty list.

The grant is `*://*.<registrable domain>/*`, for example `*://*.example.com/*`. Chrome's prompt reads "Read and change your data on all example.com sites". It is not the exact origin, on purpose. Chrome decides whether a cookie is visible by building a URL from the cookie's own domain (without the leading dot) and a scheme taken from its `Secure` flag, then checking host permission against that URL. Measured on Chrome 150 (FINDINGS §1):

- A grant on `https://a.test/*` shows only Secure cookies of `a.test`. Every non-Secure cookie is missing.
- A grant on `*://www.a.test/*` misses cookies set with `Domain=a.test`, even though the browser sends them to `www.a.test`. On many sites the session cookie is exactly that.
- `*://*.a.test/*` shows everything for the site.

An exact-origin grant would give a list that looks complete and is not. The wider site grant is the narrowest one that is correct.

Special cases:

- Public-suffix hosts (for example `github.io`) get only the exact host, never the whole suffix.
- IP literals and `localhost` get the exact host.
- Working out the registrable domain needs the Public Suffix List. It is bundled as `src/core/psl-data.js`. `npm run psl` regenerates it; that dev script downloads the list. The extension itself never downloads anything.
- "Allow on all sites" is opt-in, on the Access screen. Chrome's prompt for it is "Read and change all your data on all websites".
- The Access screen lists every grant and revokes each with one click.

## Partitioned cookies (CHIPS)

`chrome.cookies.getAll({})` returns unpartitioned cookies only. Partitioned cookies are invisible unless you ask for them (FINDINGS §2). A tool that never asks silently under-reports.

`siteQueries()` in `src/core/partition.js` issues, for each site:

1. `getAll({ domain: site, partitionKey: {} })`: unpartitioned cookies plus every partition, for cookies whose domain is the site or a subdomain.
2. `getAll({ partitionKey: { topLevelSite: "https://<site>" } })`: everything partitioned under the site, including cookies that embedded third parties set there.
3. The same with `http://<site>`.

Results are de-duplicated by cookie identity (`storeId|partition|domain|path|name`, `src/core/model.js`).

Each partitioned cookie carries a badge naming its partition: the top-level site, plus "cross-site context" where Chrome reports `hasCrossSiteAncestor: true`. `hasCrossSiteAncestor` is never invented; it is preserved as read, because Chrome rejects `false` for a cross-site cookie.

Completeness limit: an embedded third party's partitioned cookies show up only when that third party's site is also granted (or "all sites" is on). In per-site mode CookieDesk cannot even list which third parties a page embeds without the `webNavigation` permission, so the UI says that other sites' cookies may not be shown instead of claiming a complete list.

### Feature detection

| Feature | Chrome |
|---|---|
| `partitionKey` on cookies calls | 119 |
| `hasCrossSiteAncestor` | 130 |
| `getPartitionKey()` | 132 |

CookieDesk does not trust the version in the user agent. `probeFeatures()` in `src/core/cookies.js` asks Chrome: its argument validator rejects a property it doesn't know ("Unexpected property: 'hasCrossSiteAncestor'") before any permission check, so a `getAll` that matches nothing tells exactly which partition fields this Chrome accepts. Every read and write waits for that probe. Below 130 the `hasCrossSiteAncestor` field is never sent.

**Why the minimum is 119.** Measured on Chrome 116 (FINDINGS §8): the cookies API there returns partitioned cookies *without* a `partitionKey`, so they look identical to normal cookies, and editing one writes a second, unpartitioned cookie with the same name instead of changing it. No extension can list or edit cookies correctly on that API, so `minimum_chrome_version` is 119 and older Chrome refuses to install CookieDesk rather than show a mislabelled list.

`npm run test:old-chrome` checks this on real Chrome for Testing builds (`npm run get-old-chrome` downloads them into `.chrome-old/`): 116 refuses to load the extension; 119 (no `hasCrossSiteAncestor`) and 131 (no `getPartitionKey`) list and label partitioned cookies, edit one in place without creating a twin, and undo.

## Undo model

The goal in spec §13: no sequence of actions destroys a cookie without an undo. The engine is `src/core/cookies.js`; the interface is in `docs/core-contract.md` ("Transaction model"); the Chrome behaviour it is built on is in `phase0/FINDINGS.md` §3 and §6.

How a write works:

- **Same-key edit is one `set()`.** Chrome replaces an existing cookie atomically inside `set()` (events `removed/overwrite` then `added/explicit`). A rejected `set()` leaves the original untouched. There is no remove-then-set loss window.
- **Key change** (rename, domain, path, partition) is `set(new)` then delete `old`, so a failed `set` loses nothing.
- **Delete is an expired overwrite of the exact key** (`set()` with `expirationDate: 1` and the cookie's own attributes). `chrome.cookies.remove({url, name})` is not used for this: it deletes every same-name cookie that would be sent to that URL (3 cookies in one measured case), and returns a details object even when nothing was removed (FINDINGS §6).
- **Every write is verified** by an exact-key read. Return values of `set()` and `remove()` are not trusted: `set()` returns whichever same-name cookie `get` finds afterwards.
- **Write-ahead journal.** Before the first write, the cookies about to be changed (including any cookie at a new key that a rename would overwrite) are copied into `chrome.storage.session` as `undo:<id>`.
- **Failure compensates everything.** On any failed step, all steps including the failing one are rolled back, and the user is told with an explanation from `validate.js` (Chrome's own error is always the generic "Failed to parse or set cookie").
- **One Web Lock** serialises the popup, the side panel and the service worker, so concurrent edits cannot interleave.
- **Undo is itself journaled**, so it can be redone.
- **Undo checks for drift.** If a cookie changed since the action, undo refuses (`undo_conflict`) and goes ahead only if you confirm.
- **Interrupted work can be undone.** If the popup closes during an import, the journal entry is still there and the undo button reads "Undo interrupted: ...".
- **Undo is scoped to a cookie store.** Regular and incognito stores keep separate undo lists.
- **Explicit confirmation first** for the two cases the journal cannot cover: a change too large to journal (`too_large_to_undo`), and deleting a cookie that Chrome would no longer accept as stored (an old cookie that breaks a newer rule), so it could not be put back (`irreversible`).

Limits, stated plainly:

- The last 20 actions, for 10 minutes (`JOURNAL_MAX`, `JOURNAL_TTL_MS`).
- The journal lives in `chrome.storage.session`: memory only, never written to disk, extension-only access.
- Journal entries contain cookie values. They are deleted when Chrome closes, when the incognito session they belong to ends, or after 10 minutes once CookieDesk next runs.
- There is no timer, because the extension has no `alarms` permission. With no CookieDesk page open, expired copies can sit in memory until the next wake-up or until the browser closes.

## Features beyond the basics (spec P1)

- **Protected cookies.** The shield on a row (or `p`) protects a cookie: bulk delete, import and set restore leave it exactly as it is, and deleting it on its own asks first. Protection is stored in `chrome.storage.local` as the cookie's identity (store, partition, domain, path, name), never its value.
- **Bulk delete within the site.** "Delete shown cookies…" in the ⋯ menu deletes what the list currently shows (narrow it with search first), lists every cookie it will delete, keeps protected ones, and is one undo step. It is deliberately not a prominent button.
- **Cookie sets, kept as files.** "Save cookie set…" downloads the site's cookies as a named file (with the export warning); CookieDesk keeps no copy. "Restore cookie set…" makes the site's cookies match the file: it shows exactly what it will write, delete and leave alone (a dry run of the real transaction), then does it as one undo step. A set only restores on the site it was saved for, and never writes to other sites.
- **Keyboard first.** `/` search, `↓ ↑ Home End` move, `Enter` edit, `c` copy value, `p` protect, `Del` delete, `n` add, `⌘Z`/`Ctrl+Z` undo, `Esc` back, `?` the full list.
- **Live view.** When the site sets, changes or removes cookies while CookieDesk is open, the rows are highlighted and a line names what changed. CookieDesk's own edits are not reported as the site's.
- **Export formats.** CookieDesk JSON, Netscape `cookies.txt`, and "Copy as document.cookie…": a snippet for the DevTools console, copied to the clipboard after the same credential warning. HttpOnly cookies can't be set from JavaScript, so they are left out and named in the snippet.

## Security and privacy

- No cookie value is logged, persisted (apart from the in-memory journal above) or transmitted. `test/unit/no-network.test.mjs` also fails the build on any `console.log/info/debug` under `src/`.
- No cookie value is put in a URL.
- All cookie text is rendered with `textContent`. There is no `innerHTML` in `src/`.
- Export shows this warning first: "This file contains live session cookies. Anyone who has it can sign in as you on these sites. Treat it like a password and delete it when you're done." (`EXPORT_WARNING`, `src/ui/transfer.js`). The file is a local, user-initiated download.
- Import is all-or-nothing. The file is validated entry by entry, limited to 5 MB and 5000 cookies, and read through a field whitelist (no `__proto__`/`constructor` keys). Nothing is written if any entry fails. An import that would write to other sites lists every site and needs an explicit tick.
- Formats: CookieDesk JSON, a bare JSON array (the shape other cookie editors export), and Netscape `cookies.txt`.

See `PRIVACY.md` for the policy.

## No-network guarantee, and how to verify it

- Nothing in `src/` calls `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` or `importScripts`, and there are no remote scripts, fonts, images or stylesheets. `test/unit/no-network.test.mjs` is a static guard over `manifest.json` and every `.js/.json/.html/.css` file in `src/`.
- The manifest has no host access by default and no content scripts.
- The Access screen has a "Source code" link to this repository. It is a plain link you can click; nothing is fetched from it.

To check it yourself:

1. Run `npm test` and read the no-network test.
2. Open the popup (or side panel), right-click, Inspect, and open the Network tab. Use the extension through a full session: grant a site, search, edit, delete, undo, export, import. The list stays empty.
3. Do the same for the service worker: `chrome://extensions` -> CookieDesk -> Inspect views -> service worker -> Network.
4. `npm run test:e2e` asserts zero requests during a UI session.

## Testing

| Command | What it does |
|---|---|
| `npm test` | Unit tests (`node --test test/unit/`), including the no-network guard. No browser needed. |
| `npm run test:e2e` | Engine, UI, robustness and P1 feature suites in real Chrome. Needs Chrome installed. Uses HTTPS fixtures on `*.test` hosts mapped with `--host-resolver-rules`, in a throwaway profile. |
| `npm run test:permissions` | Interactive. A visible Chrome opens and you click Allow on the real permission prompts. |
| `npm run get-old-chrome` then `npm run test:old-chrome` | Downloads Chrome for Testing 116, 119 and 131 (dev only), then runs acceptance test 5 on them. |
| `npm run icons` / `npm run build` | Render `assets/icon.svg` to `icons/`; zip the extension into `dist/`. |

`test/manual-checklist.md` maps all 21 acceptance tests from the spec to how each is covered and its status, including the ones that are only partly automated.

## Project layout

```
manifest.json
src/
  background/sw.js    stateless service worker (toolbar behaviour, journal pruning)
  popup/popup.html    thin host for the shared UI
  ui/                 one UI, rendered in popup and side panel
  core/
    cookies.js        engine: list, transactional writes, undo journal
    model.js          cookie identity and round-tripping (pure)
    validate.js       legal field combinations (pure)
    partition.js      partition keys, feature detection (pure)
    site.js           registrable domain, URL classification (pure)
    psl-data.js       bundled Public Suffix List
    io.js             JSON / cookies.txt import and export (pure)
    perms.js          optional host permission request, list, revoke
icons/                toolbar and store icons (from assets/icon.svg)
scripts/              dev only: build-psl (downloads the PSL), build-icons, build, get-old-chrome
store/listing.md      Chrome Web Store listing copy
test/                 unit, e2e, manual-checklist.md
docs/core-contract.md module interfaces
phase0/               measured Chrome behaviour (FINDINGS.md) and probe
```

## License

MIT, see `LICENSE`.
