# Phase 0 findings (BUILD_SPEC_COOKIE.md §12 Phase 0, §14)

Measured on **Chrome 150.0.7871.125 (macOS)** with `phase0/run.mjs`. The fixture
is a throwaway profile with real HTTPS origins: `a.test` sets first-party
cookies and embeds an iframe from `b.test`, `www.a.test` sets a parent-domain
cookie, and `c.test` is a plain site. Raw output is in
`phase0/results-automated.json`. Ground truth comes from CDP
`Storage.getCookies`, which reads the cookie store without going through
extension permissions.

API claims were also checked against developer.chrome.com on 2026-10-21.

**One caveat:** automation can't click Chrome's native "Allow" button, so the
automated run grants hosts by loading a copy of the probe with those hosts in
`host_permissions`. The cookies API checks the extension's *active* host
permissions, so this stands in for a runtime grant. `node phase0/run.mjs
--interactive` does the real check: you click Allow, and it screenshots the
prompts (§1 below).

---

## 1. Narrow host permissions: they work, but "narrow" has to mean the whole site

| Question | Result |
|---|---|
| Install prompt for `cookies` + `storage` + `activeTab` + `sidePanel` + optional `<all_urls>` | **No warnings at all** (`getPermissionWarningsByManifest` → `[]`). `cookies` by itself has no warning. |
| Without a grant | Every `getAll` variant returns `[]` **silently**. `set`, `remove` and `getPartitionKey` throw `No host permissions for cookies at url: "https://a.test/".` |
| `permissions.request` without a user gesture | `This function must be called during a user gesture` |
| With a gesture | A prompt appears. Automation can't answer it, hence `--interactive`. |
| Host granted | `getAll` / `set` / `remove` work on that host and fail on others with the error above. |
| Prompt text, one host `https://example.com/*` or `*://example.com/*` | **"Read and change your data on example.com"** |
| Prompt text, `*://*.example.com/*` | **"Read and change your data on all example.com sites"** |
| Prompt text, `<all_urls>` | **"Read and change all your data on all websites"** |
| `optional_host_permissions: ["<all_urls>"]` | Accepted by Chrome. The docs only show `https://*/*` in examples. |

The warning strings come from Chrome itself via `getPermissionWarningsByManifest`.
The request dialog uses those same strings. Its title and buttons are in the
`--interactive` screenshots.

### The trap: a grant on `https://example.com/*` hides cookies

Chrome decides whether a cookie is visible by building a URL from the cookie
itself: `http(s)://<domain without the leading dot>/`, with the scheme set by
the cookie's `secure` flag. It then checks host permission against that URL.
Observed:

| Grant | Sees | Misses |
|---|---|---|
| `https://a.test/*` | Secure cookies of `a.test` | **Every non-Secure cookie** (`a_session`). `set` on an `http://` URL fails too. |
| `*://www.a.test/*` | `www_only` | **`parent_dom` (`Domain=a.test`)**, even though the browser sends it to `www.a.test` |
| `*://*.a.test/*` | **Everything for the site**, including subdomain and parent-domain cookies | — |

On a `www.` site the session cookie is very often a `.example.com` cookie. A
grant on the exact origin would show a list that looks complete but is missing
the important cookies. That is the P-6 "doesn't work" failure again.

**Design consequence:** the per-site grant must be `*://*.<registrable
domain>/*`, and its prompt reads "Read and change your data on all example.com
sites". Working out the registrable domain (eTLD+1) needs the **Public Suffix
List** bundled as a static file. That means no network, and it lives in a pure
module (`partition.js` or a new `site.js`). Chrome can't compute it for us before
a grant, because `getPartitionKey` itself needs host permission.

### activeTab: it gives the URL but not the cookies

After a toolbar click (`Extensions.triggerAction`), `tabs.get` returns the
tab's URL. But `cookies.getAll` still returns `[]` and `set` still throws. So
`activeTab` **lets the popup know which site to offer a grant for**. Without it,
or without `tabs`, the URL is `undefined` and we can't even name the site. It
grants no cookie access. It has no install warning.

---

## 2. Partitioned cookies (CHIPS)

| Call | Returns |
|---|---|
| `getAll({})` | **Unpartitioned only.** `a_part` and `b_part` are invisible. |
| `getAll({ partitionKey: {} })` | **Unpartitioned + every partition.** This is the call to use. |
| `getAll({ partitionKey: { topLevelSite } })` | **Only that partition** (both `hasCrossSiteAncestor` values), without unpartitioned cookies |
| `… hasCrossSiteAncestor: true/false` | Narrows to that half |
| `getAll({ domain: 'a.test', partitionKey: {} })` | Unpartitioned + partitioned cookies whose domain is `a.test` or a subdomain |
| `get({url,name})` on a partitioned cookie | `null` unless `partitionKey` is passed |
| `remove({url,name})` on a partitioned cookie | **Returns a details object, but nothing is removed.** The cookie is still there. |

- `getPartitionKey` exists (`typeof === 'function'`) and needs host permission
  for the frame. Top frame of `a.test`: `{topLevelSite:'https://a.test',
  hasCrossSiteAncestor:false}`. The `b.test` iframe: `{…, hasCrossSiteAncestor:true}`.
- `hasCrossSiteAncestor` is filled in by Chrome when omitted on `set`: `false`
  for same-site, `true` for cross-site. Passing `false` for a cross-site cookie
  is rejected: *"partitionKey has a first party value for hasCrossSiteAncestor
  when the url and the topLevelSite are not first party."* Passing `true` for a
  same-site cookie is allowed, and creates a cookie in a separate partition. So
  we never invent the field; we preserve it as read.
- A partitioned cookie without `secure` is rejected with the generic message.
- **Embedded third parties need their own grant.** `b_part` (set by the `b.test`
  iframe and partitioned under `a.test`) and `b_3p` only appear once `b.test` is
  granted. In narrow mode we can't even list which third parties are on the page
  without `webNavigation` ("Read your browsing history"). The UI must say so
  rather than present the first-party list as complete. Under "all sites",
  `getAll({partitionKey:{topLevelSite}})` returns every partitioned cookie under
  the site.
- Version gates (docs): `partitionKey` 119, `hasCrossSiteAncestor` 130,
  `getPartitionKey` 132. Feature-detect with `typeof chrome.cookies.getPartitionKey`
  and by whether returned cookies carry a `partitionKey`. *(Superseded by §8:
  tested on real old Chrome; the minimum is now 119 and detection probes Chrome.)*

---

## 3. onChanged and editing: the spec's "remove + set" premise is wrong

| Operation | Events | Notes |
|---|---|---|
| `set()` on an existing key (name+domain+path+partition), value or flags change | `removed/overwrite` → `added/explicit` | **Chrome does the swap atomically inside one `set()`.** No `remove()` call is needed. |
| `set()` that Chrome rejects, over an existing cookie | **none** | **The original is untouched.** |
| `remove()` then `set()` (the spec's order) | `removed/explicit` → `added/explicit` | Has a loss window: if `set` fails, the cookie is gone. |
| Key change (rename / path / domain): `set(new)` then `remove(old)` | `added/explicit` → `removed/explicit` | Nothing is lost if `set` fails. |
| `set()` with a past `expirationDate` | `removed/expired_overwrite` | Returns `null`. The cookie is deleted. |
| `remove()` of a cookie that doesn't exist | none | **Still returns a details object.** The return value proves nothing. |

Chrome's error for every invalid cookie is the same generic message: `Failed to
parse or set cookie named "x".` We observed it for `SameSite=None` without
Secure, Partitioned without Secure, `__Secure-` without Secure, `__Host-` with a
`domain`, Secure on an `http://` URL, and name+value over 4096 bytes. (4093 bytes
of value + the 3-byte name was accepted; 5000 bytes was rejected.) So
`validate.js` must restate every rule itself, both to block before writing and
to explain.

**Round trip:** `remove` followed by `set(toDetails(captured))` was
**byte-identical for all 16 cookies tested**. That covered host-only and domain
cookies, `httpOnly`, `sameSite` `unspecified`/`lax`/`strict`/`no_restriction`,
session cookies, a fractional `expirationDate` (1900000000.123456), a non-root
path, `__Host-`, a 4 KB value, and both partition shapes. `toDetails` is: URL
scheme from `secure`, host from the domain without its leading dot, and
`domain` only when `!hostOnly`. It also passes `expirationDate` only when
`!session` and `partitionKey` only when present.

### Proposed undo model

1. **Snapshot first.** Before any mutation, `get` the full cookie(s) it will
   destroy. That covers the target key **and** any existing cookie at a *new* key
   (a rename onto an existing name silently overwrites it).
2. **Write without a loss window.** A same-key edit is a single `set()`. A
   key-changing edit is `set(new)` then `remove(old)`. Delete is `remove()`.
3. **Verify by reading back** with `get` (+`partitionKey`), never from
   `remove()`'s return. If `set(new)` succeeded but `remove(old)` didn't, remove
   the new cookie and report. Every failure leaves the store exactly as it was
   and shows our rule explanation, not Chrome's generic text.
4. **Undo** replays the snapshots with `set(toDetails(c))` and removes any keys
   the operation created. E5 shows this is byte-identical.
5. **Live list:** tag in-flight keys (`storeId|name|domain|path|partitionKey`),
   absorb their `overwrite`/`explicit` pair, and refresh with one debounced
   `getAll({partitionKey:{}, …})` (~50 ms) instead of patching per event. No
   flicker, no duplicates.
6. **Where the undo buffer lives.** This needs your decision. The popup closes
   on blur, so an undo kept in page memory dies the moment the user clicks the
   page to check the result. My proposal is `chrome.storage.session`. It is
   in-memory only, never written to disk, cleared on browser restart, and
   restricted to the extension by default. Keep the last 20 operations, with a
   10-minute TTL. That stretches rule 3 ("never persist a cookie value") to
   "never persist to disk". The alternative is undo that only works while the
   popup stays open.

---

## 4. Permission set

`cookies` + `storage` + optional hosts is **not quite enough**:

| Permission | Why | Install warning |
|---|---|---|
| `cookies` | the API | none |
| `storage` | settings, granted-site bookkeeping | none |
| `activeTab` | the tab's URL after a toolbar click, so we can name the site and request the right grant | none |
| `sidePanel` | P0-8 (the docs say it's required) | none |
| `optional_host_permissions: ["<all_urls>"]` | per-site `*://*.site/*` grants, plus "all sites" opt-in | none at install |

The install prompt stays completely clean. The **side panel** has one
limitation. `activeTab` is per tab and per click, and we can't read URLs
without `tabs` ("Read your browsing history"). So after the user navigates
somewhere ungranted, the open panel can't tell which site it's on. For granted
sites the URL *is* readable, because a host grant exposes `tab.url`. Options:
show "click the toolbar button to load this tab" in that case, or offer
**optional** `tabs` as an opt-in inside the panel. I recommend the former for
v1.

## 5. What in the spec is wrong or needs changing

1. **§5.4 / test 8.** Editing is not remove+set. `set()` overwrites atomically,
   and a failed `set` destroys nothing. Using `set` (and set-then-remove for key
   changes) removes the data-loss hazard instead of just mitigating it. Test 8
   becomes "force the *remove* half of a key change to fail → rolled back".
2. **§5.2.** "Request that origin only (`https://example.com/*`)" produces an
   incomplete list: no non-Secure cookies and no parent-domain cookies. Request
   `*://*.<eTLD+1>/*` and bundle the PSL. The prompt says "all example.com sites".
   The listing should say that too.
3. **§7.** `activeTab` and `sidePanel` are needed in `permissions`. Both have no
   warning.
4. **§5.3.** The completeness promise depends on what's granted. A site's
   embedded third parties (including their CHIPS cookies) need their own grants.
   Narrow mode must say "cookies from other sites embedded in this page aren't
   shown". It can't count them without `webNavigation`.
5. **§5.1.** `remove()` returns a details object even when nothing was deleted,
   and ignores partitioned cookies unless you pass their `partitionKey`. Always
   verify with `get`.
6. **§9 test 20.** The 4 KB limit is on **name + value**: 4096 bytes accepted,
   more is rejected.
7. **Chrome errors are generic**, so `validate.js` carries the rules: None ⇒
   Secure; Partitioned ⇒ Secure; `__Secure-` ⇒ Secure; `__Host-` ⇒ Secure +
   host-only + `path=/`; Secure ⇒ https; name+value ≤ 4096; no cross-site cookie
   with `hasCrossSiteAncestor:false`.
8. Default cookie store id is `"0"`. Incognito (expected `"1"`) is Phase 3.

## Files

- `phase0/probe/` is the throwaway probe extension. It has `webNavigation`
  for frame IDs only, which the product won't need.
- `phase0/run.mjs` runs the probe automated (headless) or with `--interactive`.
- `phase0/cdp.mjs` is the zero-dependency CDP driver, from JSToggle.
- `phase0/results-automated.json` is the raw output.

---

## 6. Found during Phase 1 (same Chrome 150 build)

- **`remove({url, name})` is not precise.** It deletes *every* same-name cookie
  that would be sent to that URL. On `https://a.test/x` it removed the host-only
  `/` cookie, the `.a.test` `/` cookie, and the `/x` cookie: three of them. On
  `https://www.a.test/` it removed both the `www.a.test` and the `.a.test` cookies.
  Partitioned cookies were spared unless `partitionKey` was passed, and so were
  Secure cookies when the URL was `http://`.
  **Precise delete = `set()` the exact key (the cookie's own attributes) with
  `expirationDate: 1`.** That deleted exactly the target in all 5 overlap cases,
  partitioned included. `remove()` is kept only as a fallback, and it snapshots
  and restores the same-name neighbours.
- **`set()`'s return value is `get(url, name)` after the write**, so it can be a
  *different* same-name cookie. It is `undefined` for partitioned writes and for
  an `expirationDate` far in the past. Only a `getAll` with an exact key match
  verifies a write.
- **"Leave Secure cookies alone":** Chrome rejects a non-Secure cookie when a
  Secure cookie with the same name exists on an overlapping domain. The error is
  the generic one. `validate.js` can't see this (it needs the store), so
  `cookies.js` explains it after a rejection (`secure_shadow`).

## 7. Found during Phase 3 (Chrome 150)

- **Chrome caps cookies per registrable domain at about 180.** Writing 240 cookies to subdomains of one site left 151 (Chrome evicts down to 150). So a site's full list is bounded; no virtualised list is needed.
- **Incognito:** a spanning-mode extension with "Allow in Incognito" sees store `"1"` for incognito tabs. A regular-window extension page can read and write it with `storeId: '1'`.
- **The `chrome.extension` namespace is gone in MV3** (`isAllowedIncognitoAccess` is undefined). Opening an incognito window is the practical test.
- **Test environment only:**
  - Branded Chrome disables a CDP-loaded unpacked extension when it reloads (for example after toggling incognito access). `management.setEnabled(id, true)` turns it back on with the setting kept.
  - Headless Chrome can hide a page shortly after another window opens. A hidden page's queued tasks (a `<dialog>`'s `close` event) then wait, which only matters to tests.

---

## 8. Found during Phase 4: old Chrome (Chrome for Testing 116, 119, 131)

Run with `npm run get-old-chrome && npm run test:old-chrome`. This corrects §2,
which assumed old Chrome simply *hides* partitioned cookies.

- **Chrome 116 (no `partitionKey` in the API) returns partitioned cookies, unlabelled.**
  `getAll({domain:'a.test'})` and `getAll({})` include `a_part` and the third-party
  `b_part` with no `partitionKey` field, indistinguishable from normal cookies.
  `getAll({partitionKey:{}})` throws `Unexpected property: 'partitionKey'`.
- **Editing one there corrupts the jar.** `set()` of `a_part` (no partition key
  possible) left the partitioned `a_part` untouched and added a second,
  unpartitioned `a_part`. A list would then show two identical rows.
  → No correct editor is possible below 119: **`minimum_chrome_version` is now 119**
  (was 116). Chrome 116 refuses to load the extension; the test asserts that.
- **The user agent is not a safe feature test.** Headless Chrome reports
  `HeadlessChrome/119…`, which the old `\bChrome\/` regex missed, so the engine
  assumed every API and sent `hasCrossSiteAncestor` to Chrome 119. Every exact-key
  read then threw `Unexpected property: 'hasCrossSiteAncestor'` and edits failed
  (rolled back, nothing lost). Fix: `probeFeatures()` asks Chrome directly. The
  argument validator rejects unknown properties before any permission check, so
  a `getAll` that matches nothing is an exact, side-effect-free probe.
- **Chrome 119 and 131** (no `hasCrossSiteAncestor` / no `getPartitionKey`):
  partitioned cookies are listed and labelled, editing changes the cookie in place
  with no twin, and undo restores it.
- Chrome for Testing on macOS blocks at startup on a Keychain prompt unless
  launched with `--use-mock-keychain`.
