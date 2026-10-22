# Core module contract (Phase 1)

The interfaces between `src/core/*` modules. Several people/agents build these
in parallel; code against these signatures exactly. Background: `phase0/FINDINGS.md`.

Conventions: plain ES modules, no dependencies, no build step, no `chrome.*`
in pure modules (they run under `node --test`). Never `console.log` a cookie
value anywhere. Comments sparse, explain *why*.

## Shared shapes

```js
// Cookie — exactly what chrome.cookies returns.
{ name, value, domain, hostOnly, path, secure, httpOnly,
  sameSite: 'no_restriction'|'lax'|'strict'|'unspecified',
  session, expirationDate?, storeId, partitionKey?: { topLevelSite?, hasCrossSiteAncestor? } }

// Draft — what the editor / importer produces (same field names; storeId optional).
// partitionKey: null/undefined = unpartitioned. hostOnly true = no Domain attribute.
```

## `site.js` (PURE) — registrable domain, URL classification, origin patterns

```js
registrableDomain(host) -> string
  // eTLD+1 per the Public Suffix List (ICANN + private sections, like Chrome's cookie code).
  // Lowercases, strips one trailing dot. IPv4/IPv6 literal, 'localhost', and single-label
  // hosts return the host itself. A host that IS a public suffix returns itself.
isPublicSuffix(domain) -> boolean          // leading '.' ignored
classifyUrl(url) -> { kind: 'web', scheme, host, site }        // http/https only
                  | { kind: 'restricted', reason, scheme }
  // reason: 'browser' (chrome:, edge:, about:, devtools:, view-source:, chrome-search:, chrome-untrusted:)
  //         'extension' (chrome-extension:, moz-extension:)
  //         'webstore' (https://chromewebstore.google.com/…, https://chrome.google.com/webstore…)
  //         'file' (file:), 'other' (data:, blob:, javascript:, unknown or unparsable)
originPatternFor(site) -> string           // '*://*.example.com/*'; IP literal -> '*://1.2.3.4/*'; 'localhost' -> '*://localhost/*'
patternToSite(pattern) -> string | null    // inverse; '<all_urls>' / '*://*/*' -> null (all sites)
isAllSitesPattern(pattern) -> boolean
domainMatchesSite(cookieDomain, site) -> boolean   // '.a.example.com', 'example.com' within site 'example.com'
```

## `model.js` (PURE) — identity and round-tripping (owner: lead)

```js
cookieKey(c) -> string          // storeId|partition|domain|path|name — Chrome's identity for a cookie
partitionId(pk) -> string       // '' for unpartitioned
toSetDetails(c) -> object       // chrome.cookies.set() details that recreate c byte-identically
toLookup(c) -> { url, name, storeId, partitionKey? }   // for get/remove
sortCookies(list) -> list
```

## `validate.js` (PURE) — legal field combinations

```js
validateCookie(draft, ctx?) -> { errors: Issue[], warnings: Issue[] }
  // ctx: { now?: number /* ms */, isPublicSuffix?: (domain) => boolean, pageSite?: string }
  // Issue: { field: 'name'|'value'|'domain'|'path'|'expirationDate'|'secure'|'httpOnly'|'sameSite'|'partitionKey'|null,
  //          code: string, message: string /* plain English, explains the rule */ }
```

Rules (Chrome only says "Failed to parse or set cookie", so we explain):
errors: SameSite=None ⇒ Secure · Partitioned ⇒ Secure · `__Secure-` ⇒ Secure ·
`__Host-` ⇒ Secure + host-only + path `/` · name+value ≤ 4096 bytes (UTF-8) ·
forbidden chars in name/value (control chars, `;`; `=` in name) · empty name
and empty value together · path must start with `/` and be ≤ 1024 bytes ·
domain non-empty valid hostname, ≤ 1024 bytes, not a public suffix (when ctx.isPublicSuffix given) ·
partitionKey.topLevelSite must be `https://<site>` · `hasCrossSiteAncestor:false`
when the cookie domain is not same-site with topLevelSite · invalid sameSite value
· non-boolean flags · non-finite expirationDate.
warnings: expirationDate ≤ now ⇒ code `expired_deletes` ("Saving with an expiry in
the past deletes this cookie.") · expirationDate > now + 400 days ⇒ `clamped_400d`
· domain outside ctx.pageSite ⇒ `other_site` · empty name ⇒ `empty_name`.

## `partition.js` (PURE) — partition keys and feature detection (owner: lead)

```js
features({ chromeMajor, hasGetPartitionKey }) -> { partitionKey, hasCrossSiteAncestor, getPartitionKey }
chromeMajorFromUA(userAgent) -> number | null
isPartitioned(c) -> boolean
partitionLabel(pk, site?) -> string
siteQueries(site, feats, storeId) -> getAll details[]
```

## `io.js` (PURE) — import / export

```js
exportJson(cookies, { site, storeId, now }) -> string
  // { "format": "cookiedesk", "version": 1, "exportedAt": ISO, "site", "storeId", "warning": "...", "cookies": [Cookie-without-storeId] }
parseImport(text, ctx?) -> { ok: true, drafts: Draft[], domains: string[], source: 'cookiedesk'|'array'|'netscape', warnings: string[] }
                         | { ok: false, error: { code, message, index? } }
  // Accepts our envelope, a bare array (Cookie-Editor / EditThisCookie export shape), or Netscape cookies.txt.
  // All-or-nothing: any invalid entry -> ok:false with a specific message naming the entry index and field.
  // ctx: { now, isPublicSuffix, maxBytes = 5_000_000, maxCookies = 5000 }
  // Copies only whitelisted fields (never trusts __proto__/constructor keys); runs validateCookie on each.
exportNetscape(cookies) -> string   // '#HttpOnly_' prefix for httpOnly; session -> expiry 0
```

## `cookies.js` (chrome wrapper) — list, transactional writes, undo

```js
createEngine({ cookies?, storage?, feats?, now?, locks? }) -> engine   // defaults: chrome.cookies, chrome.storage.session, navigator.locks
probeFeatures(cookies) -> feats                    // asks Chrome which partitionKey properties its validator accepts
engine.feats / engine.ready                       // without injected feats: UA estimate, corrected by probeFeatures before any read or write
engine.list({ site, storeId }) -> Cookie[]            // domain = site or a subdomain, both partitions, + third parties partitioned under site
engine.findExact(cookie) -> Cookie | null
engine.stores() -> CookieStore[]
engine.save(original | null, draft, { allowIrreversible? }) -> { undoId, cookie }   // create or edit; an expired draft deletes
engine.remove(cookies[], { allowIrreversible? }) -> { undoId }
engine.importDrafts(drafts, { storeId }) -> { undoId, written }
engine.undo(id?, { force?, storeId? }) -> { label, skipped: string[] }   // newest (in that store) by default; is itself undoable
engine.undoList({ storeId? }) -> [{ id, label, at, interrupted, count }]  // no values; safe to render; scoped to one store
engine.pruneJournal({ liveStores? })                  // drop expired entries, and entries of stores that no longer exist
engine.onChange(listener) -> unsubscribe              // one call per logical change, debounced
```

Every write throws `CookieError { code, message, cookie?, field?, rolledBack? }` with a
message meant for the user. Codes: `invalid` (validate.js rule), `no_permission`,
`secure_shadow`, `rejected`, `not_stored`, `not_removed`, `gone`, `duplicate`,
`imprecise_delete`, `irreversible` (retry with `allowIrreversible` after the
user agrees), `too_large_to_undo` (same), `partition_unsupported`,
`undo_expired`, `undo_conflict` (retry with `force` after the user agrees; `cookies` lists the names).

Transaction model (FINDINGS §3, §6):
- One Web Lock covers popup, panel and worker.
- The journal entry goes into `chrome.storage.session` (`undo:<id>`, last 20,
  10 min) **before** the first write.
- Each step changes one key. A same-key edit is a single `set`. A key change sets
  the new cookie, then deletes the old. A delete is an expired overwrite of the
  exact key.
- Every write is verified by an exact-key read.
- On failure every step is compensated, the failing one included.

## `perms.js` (chrome wrapper)

```js
requestSite(site) / requestAllSites()   // call synchronously inside a click handler
siteAccess(site) -> { granted, via: 'all'|'site'|null }
grants() -> { allSites, sites: [{ pattern, site }], patterns }
revoke(pattern | ALL_SITES)
onGrantsChanged(listener) -> unsubscribe
```
