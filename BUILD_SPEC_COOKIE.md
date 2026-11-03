# BUILD SPEC / PROMPT — cookie editor ("CookieDesk")

> **How to use this file.** Paste it into Claude Code as the opening prompt, or
> keep it in the repo and say: *"Read BUILD_SPEC_COOKIE.md and implement Phase 0."*
> Self-contained: every requirement, constraint, API hazard and acceptance test
> is here.
>
> Fourth in the series after `BUILD_SPEC.md` (Tab Mosaic),
> `BUILD_SPEC_JS_TOGGLE.md` and `BUILD_SPEC_EPUB.md`. Same thesis each time:
> **a popular utility was abandoned or betrayed its users, in a specific
> nameable way, and nobody has fixed it.**

---

## 0. Your role and the rules of engagement

You are building a production Chrome extension (Manifest V3) from scratch. Work
in phases (§12). After each phase, stop and report what works and what doesn't.

**Five standing rules:**

1. **Verify every Chrome API claim here against current official docs before
   relying on it** (`developer.chrome.com/docs/extensions/reference/api/cookies`).
   §5 is written from those docs but versions move. If the docs or your tests
   contradict this file, **they win** — tell me what changed.
2. **No network calls. Ever.** No analytics, no telemetry, no remote config, no
   CDN fonts, no "sponsored" anything. This is a hard requirement *and* the
   central marketing claim — the 200k clone in this niche is being savaged for
   silently adding spam banners.
3. **This extension can read session cookies, i.e. live credentials.** Treat
   every design decision as a security decision. Never log a cookie value, never
   put one in a URL, never persist one outside the user's explicit export.
4. **Never silently show an incomplete list.** `getAll` quietly omits domains you
   lack permission for, and partitioned cookies are invisible unless you ask for
   them. Both failure modes look like "the extension is broken" (§5).
5. **Ask for the narrowest permission that works.** The default install must not
   demand "read and change all your data on all websites" (§5.2).

---

## 1. Why this product exists (market evidence)

Verified live on 2026-10-21 across 20 cookie-tool extensions.

```
Cookie-Editor            2,000,000u  4.40*   419rv  v1.13.0  STALE since 2024-02-26
EditThisCookie (V3)        400,000u  4.29*    97rv           STALE since 2025-09-12
Cookie Editor (a clone)    200,000u  3.50*   305rv           maintained, spam-injecting
Cookie Remover             100,000u  3.92*   102rv           maintained
CookieManager               60,000u  3.38*    31rv           maintained
MILK - Cookie Manager        20,000u  4.51*    33rv           STALE
Easy Cookie Editor          10,000u  4.43*    16rv           STALE
                          ─────────
cookie-EDITING demand     ~2,700,000u
(whole cookie tooling category incl. consent blockers: ~4,140,000u)
```

**The 2M-user leader is rated 4.40 stars and has not shipped since February 2024
— two years and eight months.** This is the cleanest case in the whole research
set: users did not leave because the product was bad, so there is no migration
already in flight to fight against. The best *maintained* option in the niche
has 100,000 users at 3.92 stars.

The clone that moved into the gap is being punished for how it monetised:

> *"its a **copy/fake** one. The OG: Cookie-Editor - cookie-editor.com 4.4 (410 ratings) 2,000,000 users"* — 1 star
> *"**Silently added spam banners** after upgrade."* — 1 star
> *"spam banners, **no search** :("* — 2 stars
> *"**Doesn't work at all**"* — 1 star
> *"always show download mannager"* — 1 star
> *"I don't like the side-panel solution!"* — 2 stars

**Checks already done, so you don't repeat them:**
- `chrome.cookies` is fully supported in MV3 and actively extended — `partitionKey`
  (Chrome 119+), `hasCrossSiteAncestor` (130+), `getPartitionKey()` (132+). This
  category is **not** platform-dead.
- Chrome has **no** built-in cookie editor. DevTools → Application → Cookies can
  view and edit, but it is several clicks deep, has no search across domains, no
  import/export, and no bulk operations.
- `EditThisCookie`, the original famous tool, died and a fork (`V3`) is itself now
  stale — so forking abandoned cookie tooling is a proven pattern here.

---

## 2. Who uses it, and for what

A developer/QA audience, not general consumers:

- **Web developers** inspecting auth and session state while debugging.
- **QA and test engineers** switching between logged-in states without clearing
  everything, and reproducing bugs tied to a specific cookie value.
- **Support engineers** asking a user to export cookies for a repro (export is a
  real workflow — and a real security hazard, see §9).
- **Privacy-minded users** deleting specific tracking cookies rather than
  nuking all site data.
- **Automation authors** seeding a cookie to skip a login in a scripted flow.

They want: see every cookie for this site, read and edit each field including the
ones the page's own JavaScript cannot touch (`httpOnly`), search, delete
precisely, and move a set of cookies between profiles.

---

## 3. The pains, each mapped to a requirement

**P-1 — The 2M leader is simply gone.** No update since 2024-02-26. Nothing is
broken; it is just frozen while Chrome's cookie model moved on (CHIPS
partitioning landed in Chrome 119, after its last release). A frozen cookie tool
**silently misses partitioned cookies** — which looks exactly like a bug.

**P-2 — The replacement monetised with spam.** *"Silently added spam banners
after upgrade."* The audience is developers; they notice and they leave.

**P-3 — No search.** *"spam banners, no search :("* Developers routinely work on
sites with 30+ cookies. A list with no filter is unusable.

**P-4 — Identity confusion in the store.** Users cannot tell the clone from the
original and write reviews warning each other. A clear, honest listing and an
open-source link is a differentiator by itself.

**P-5 — Forced UI changes.** *"I don't like the side-panel solution!"* Do not
force one surface; offer popup **and** side panel, let the user choose.

**P-6 — Unexplained emptiness.** *"Doesn't work at all."* Almost certainly a
permissions or partitioning miss (§5). Every empty state must say *why*.

---

## 4. What NOT to build (explicit non-goals)

- No consent-banner blocking ("I don't care about cookies" territory, 900k users
  at 2.84 stars) — different product, filter-list maintenance forever.
- No ad blocking, no tracker blocking, no filter lists.
- No cloud sync of cookies. **Never** transmit a cookie anywhere (rule 3).
- No accounts, no paid tier in v1, no banners, no "sponsored" anything.
- No bulk "delete all cookies everywhere" as a prominent action — it is a
  footgun that logs the user out of everything. Bury it behind confirmation.
- No content scripts unless a feature provably needs one.

---

## 5. THE CRITICAL DESIGN DECISIONS

### 5.1 Verified API facts

- Requires `"cookies"` in `permissions` **and** `host_permissions` for every host
  whose cookies you touch.
- `get(details)` — one cookie; with duplicate names, returns longest path, then
  earliest creation.
- `getAll(details)` — filter by `domain, name, path, secure, session, storeId,
  url, partitionKey`. **It silently returns only domains you have host
  permission for.**
- `set(details)` — `url` required. Omitting `domain` creates a host-only cookie.
  `httpOnly` and `secure` default to `false`; `sameSite` defaults to
  `unspecified`. May overwrite an equivalent cookie. **Setting an already-past
  `expirationDate` deletes the cookie** (`cause: "expired_overwrite"`).
- `remove(details)` — deletes **one** cookie by name via `url` (+ optional
  `storeId` / `partitionKey`). **There is no bulk remove**; loop.
- `getAllCookieStores()` — each store has `id` and the `tabIds` sharing it.
  **Incognito is a separate cookie store** — target it by `storeId`.
- `getPartitionKey(details)` (Chrome 132+) — partition key for a frame.
- `onChanged` — fires with `cause` and a `removed` flag.
- Cookie fields: `name, value, domain, path, secure, httpOnly, sameSite
  ('no_restriction'|'lax'|'strict'|'unspecified'), expirationDate, hostOnly,
  session, storeId, partitionKey`.

### 5.2 Permission strategy — the main product decision

`"cookies"` + `host_permissions: ["<all_urls>"]` produces the scariest prompt in
Chrome ("Read and change all your data on all websites"). For a cookie tool —
a category with a genuine malware history — that prompt plus a 200k clone caught
injecting spam is a trust disaster.

**Required approach: optional host permissions, granted per site.**

```json
{
  "permissions": ["cookies", "storage"],
  "optional_host_permissions": ["<all_urls>"],
  "action": { "default_popup": "popup.html" },
  "side_panel": { "default_path": "panel.html" }
}
```

- On first use for a site, request that origin only
  (`chrome.permissions.request({origins:["https://example.com/*"]})`).
- Show which origins are granted, and let the user revoke each one.
- Offer "grant all sites" as an explicit, clearly-explained opt-in for people who
  want the old frictionless behaviour.
- **Verify in Phase 0**: that a runtime-granted origin is enough for
  `getAll`/`set`/`remove` on that origin, and what prompt the user actually sees.

This is the same trust play as `BUILD_SPEC_JS_TOGGLE.md` §4, and here it is
stronger because the alternative prompt is so much worse.

### 5.3 Partitioned cookies (CHIPS) — why the incumbent is quietly wrong

By default every `cookies` method operates on **unpartitioned** cookies only.
A cookie set with `Partitioned` is invisible unless you pass `partitionKey`.
The 2M incumbent last shipped before Chrome 119, so it cannot see them.

Required behaviour:
1. Always query unpartitioned **and** partitioned cookies for the active site.
2. Label partitioned cookies distinctly in the UI, showing their partition key.
3. Where available, use `getPartitionKey()` for the active frame.
4. Respect `hasCrossSiteAncestor` (Chrome 130+): a top-level site in a cross-site
   context must not reach cookies it set in a same-site context.
5. If the running Chrome is too old for these fields, feature-detect and degrade
   with a visible note. Never pretend the list is complete.

### 5.4 Editing is a two-step operation — handle it

Changing a cookie's properties is **remove + set**, so `onChanged` fires twice
(`cause: "overwrite"` then `"explicit"`). Consequences:

- A naive live-updating list will flicker or double-render. Debounce and
  reconcile against your own pending-write set.
- If the `set` half fails (e.g. invalid `sameSite`/`secure` combination), the
  user has **lost the cookie**. Capture the original first and offer **undo**;
  on failure, restore automatically and say so.
- `secure: false` with `sameSite: 'no_restriction'` is rejected by Chrome.
  Validate in the UI *before* writing, and explain the rule.

---

## 6. Feature specification

### P0 — must ship in v1

| ID | Feature | Pain |
|---|---|---|
P0-1 | **List every cookie for the active site**, unpartitioned *and* partitioned, with an explicit count. | P-1 |
P0-2 | **Edit every field**: name, value, domain, path, expiry, `secure`, `httpOnly`, `sameSite`. Validate illegal combinations before writing. | core |
P0-3 | **Search / filter** by name, value and domain, live. | P-3 |
P0-4 | **Add** a cookie and **delete** one precisely, with **undo** on both and on edit. | §5.4 |
P0-5 | **Partitioned-cookie support**, clearly labelled with partition key. | P-1 |
P0-6 | **Per-site permission flow** — narrow by default, visible granted-origins list, revocable. | P-4, trust |
P0-7 | **Honest empty states**: distinguish "no cookies", "permission not granted for this origin", "restricted page (chrome://, Web Store)", "partitioned cookies hidden — your Chrome is too old". | P-6 |
P0-8 | **Popup *and* side panel**, user's choice, same component. | P-5 |
P0-9 | **Import / export JSON** for the current site, with an explicit security warning on export. | workflow |
P0-10 | **Zero network, zero ads, no banners.** Verifiable in DevTools. | P-2 |
P0-11 | **Incognito / profile cookie stores** selectable via `getAllCookieStores()`. | correctness |

### P1 — fast follow

- P1-1 Protect / pin a cookie so bulk operations skip it.
- P1-2 Bulk delete *within the current site*, with a confirm listing what dies.
- P1-3 Named cookie profiles: save a set, restore later (e.g. "logged-in as admin").
- P1-4 Keyboard-first operation; copy a single value with one keystroke.
- P1-5 `onChanged` live view — watch cookies change as you use the site.
- P1-6 Export formats: JSON, Netscape `cookies.txt`, and a `document.cookie` snippet.

### P2 — later

- P2-1 Diff two cookie sets (before/after a login flow).
- P2-2 Cross-profile copy via explicit `storeId` selection.
- P2-3 A read-only "explain this cookie" panel (flags in plain English).

---

## 7. Technical architecture

- **Manifest V3**, service worker (`type: "module"`). Assume it is killed
  aggressively — **no in-memory state survives**; rebuild from
  `chrome.storage.local`.
- **Permissions**: `cookies`, `storage`, plus `optional_host_permissions`.
  Nothing else without justifying it to me first. No `tabs` (use `activeTab`
  semantics via the action click), no `scripting`, no `<all_urls>` by default.
- **Never persist cookie values.** Settings and granted-origin bookkeeping only.
  Exports go straight to a user-initiated download.

```
manifest.json
src/
  ui/      panel.html  panel.js  panel.css      // ONE component, rendered in popup + side panel
  popup/   popup.html                           // thin host for ui/
  core/
    cookies.js     // chrome.cookies wrapper: list (both partitions), set, remove, undo
    validate.js    // legal field combinations. PURE, unit-tested
    partition.js   // partitionKey handling + feature detection. PURE, unit-tested
    perms.js       // optional host permission request / list / revoke
    io.js          // import/export JSON + cookies.txt. PURE, unit-tested
test/
  manual-checklist.md
  unit/            // validate.js, partition.js, io.js
```

`validate.js`, `partition.js` and `io.js` must be **pure functions** — testable
without a browser. That is where correctness lives.

---

## 8. UX requirements

- The list is the product: dense, scannable, searchable, sorted sensibly, with
  `httpOnly` / `secure` / `session` / `partitioned` shown as compact badges.
- **Every destructive action is undoable** and says what it did.
- Values can be enormous (JWTs). Truncate with expand, never break the layout,
  and provide copy-to-clipboard.
- Mark `httpOnly` cookies clearly as *"not visible to page JavaScript"* — that is
  the single capability DevTools-shy users come for.
- Permission UI is honest and legible: which origins are granted, what that
  allows, one click to revoke.
- No upsell, no rating nag, no banners, no side-panel-only forcing.
- Respect `prefers-color-scheme` and `prefers-reduced-motion`. Full keyboard
  operation. Visible focus rings.
- **Security hygiene in the UI**: an export warning that says in plain words that
  the file contains live session tokens and should be treated like a password.

---

## 9. Acceptance tests (each maps to a real review or a verified API hazard)

Into `test/manual-checklist.md`. Pure modules get unit tests.

**Completeness — the release gate (P-1, P-6)**

1. A site with both normal and `Partitioned` cookies → **both** listed,
   partitioned ones labelled with their key. *(The 2M incumbent fails this.)*
2. A site where permission has not been granted → the empty state says so and
   offers the grant button. **Never a bare empty list.**
3. `chrome://extensions` and the Web Store → explained, not apparently broken.
4. A site with 40+ cookies → search filters by name, value and domain live.
5. Chrome older than the partition APIs (if testable) → feature-detected, note
   shown, no crash.

**Safety of editing (§5.4)**

6. Edit a cookie's value → exactly one logical change; list does not flicker or
   duplicate; `onChanged` double-fire is absorbed.
7. Edit a cookie to an illegal combination (`sameSite: 'no_restriction'` with
   `secure: false`) → **blocked before writing**, rule explained. The original
   cookie still exists.
8. Force the `set` half to fail → the original is restored automatically and the
   user is told. **No silent loss.**
9. Set an expiry in the past → UI states plainly that this deletes the cookie.
10. Delete a cookie → undo restores it byte-identically, including `httpOnly`,
    `secure`, `sameSite`, path and expiry.
11. Edit a session cookie on a site you are logged into → you stay logged in
    unless you changed something that should log you out.

**Permissions (P-4, §5.2)**

12. Fresh install → the prompt does **not** request all-sites access.
13. Grant one origin → cookies readable and writable there, and nowhere else.
14. Revoke that origin → list empties with the correct explanation.
15. "Grant all sites" opt-in → works, and the granted list reflects it.

**Stores and robustness**

16. Incognito window (with incognito access enabled) → its separate cookie store
    is selectable and correct.
17. Service worker terminated mid-session → UI recovers, granted origins intact.
18. Export then import on a clean profile → identical cookie set, all flags
    preserved. Export shows the security warning.
19. Import a malformed/hostile JSON file → rejected with a specific message, no
    partial write.
20. A cookie with a 4KB value → renders, copies and edits without breaking.
21. DevTools Network tab across a full session → **zero requests.**

---

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
**The permission prompt** ("read and change all your data on all websites") kills installs for a tool in a malware-prone category. | **High** | §5.2 optional per-site host permissions by default. Open source. Zero network. Say all of this in the listing. |
**Partitioned cookies silently missing** → "doesn't work" reviews, the exact trap the incumbent is in. | **High** | P0-5, tests 1 and 5. Never claim a complete list you cannot deliver. |
**Data loss on edit** — editing is remove+set, so a failed write destroys a cookie. | **High** | Undo on every mutation, auto-restore on failure, tests 8 and 10. |
**Security exposure** — exports contain live session tokens; this is a credential-handling tool. | **High** | Never transmit, never log, never persist values. Explicit export warning. Rule 3. |
**Store review scrutiny** — cookie access is heavily abused, so expect a hard look. | Medium | Minimal permissions, single clear purpose, privacy policy stating no collection, open-source link in the listing. |
**Chrome's third-party cookie plans** keep shifting; partitioning behaviour may change again. | Medium | Feature-detect everything; keep `partition.js` isolated and pure so a model change is a local edit. |
**The original could return** after 2.7 years. | Low-Med | Possible but the gap is long. Your edge is partitioning support and a trustworthy permission story, not merely being alive. |
Name collision in a store already full of "Cookie Editor" clones. | Medium | §11 — distinct name, keyword-first title, explicitly honest listing. |

**Data caveats:** Chrome Web Store user counts are **bucketed** by Google, so
these are approximate. The pain quotes come from ~10 recent reviews per
extension — a modest sample — but the dates (2024-02-26) and ratings were
verified directly from the live detail pages on 2026-10-21.

---

## 11. Store listing — ranking notes

Measured from 99 real CWS SERP rows: **the title does nearly all the ranking
work**; a 3-user extension outranked a 1,000,000-user one on title match, and
descriptions are indexed weakly. Lead with keywords, not a brand.

- **Title (keyword-first; verify the current cap):**
  `Cookie Editor — View, Edit & Delete Cookies`
- **Short description (~132 chars):**
  `Inspect, edit, add and delete cookies per site. Search, import/export, partitioned-cookie support. No ads, no tracking.`
- **Long description** must contain, in searched form: *cookie editor, edit
  cookies, cookie manager, view cookies, delete cookies, cookie viewer*.
- **Lead on the three things the incumbents lack**: partitioned (CHIPS) cookie
  support, real search, and **no ads / no tracking / open source**.
- Uncontested long tail: *"cookie editor no ads"*, *"partitioned cookie editor"*,
  *"edit httponly cookie"*, *"cookie editor open source"*.
- **Say plainly that you are not affiliated with Cookie-Editor or
  EditThisCookie.** Reviewers in this niche actively warn each other about
  clones; being unambiguous is a feature.

---

## 12. Build phases — stop and report after each

**Phase 0 — Settle permissions and partitioning (before any UI).**
1. Confirm a **runtime-granted single origin** is sufficient for
   `getAll` / `set` / `remove` on that origin, and report the exact prompt text
   the user sees for both the narrow and the all-sites request.
2. Prove partitioned-cookie read/write: set a `Partitioned` cookie, confirm it is
   invisible without `partitionKey` and visible with it. Check
   `getPartitionKey()` and `hasCrossSiteAncestor` availability.
3. Confirm the remove+set double `onChanged` behaviour and design the undo model
   around what you observe.
**Report all three before writing the real thing.** If narrow host permissions
turn out not to work, tell me — that changes the product's trust story and I will
re-aim the listing.

**Phase 1 — Core engine.** `cookies.js`, `validate.js`, `partition.js`, `io.js`,
pure modules unit-tested. Tests 1, 5–11, 18–20.

**Phase 2 — UI.** One component in popup + side panel, search, badges, honest
empty states, permission management screen. Tests 2–4, 12–15, 21.

**Phase 3 — Robustness.** Incognito stores, worker death, huge values, hostile
imports. Tests 16–17.

**Phase 4 — Release prep.** Full §9 checklist, README documenting the undo model
and the zero-network guarantee, listing copy per §11, screenshots, open-source repo.

**Phase 5 — P1 features**, only after a clean Phase 4.

---

## 13. Definition of done for v1

- Every §9 test passes. Nothing marked passed "with a caveat".
- **Zero network requests** across a full session, visible in DevTools.
- Default install does **not** request all-sites access.
- Partitioned cookies are listed and labelled; no silent omissions anywhere.
- **No sequence of actions destroys a cookie without an undo.**
- No cookie value is ever logged, persisted, or transmitted.
- `README.md` documents the undo model, the partitioning handling and the
  no-network guarantee well enough for a reviewer to verify them.

---

## 14. First response I want from you

Before writing production code:

1. Report the Phase 0 findings on **narrow host permissions** (does a
   runtime-granted origin suffice, and what is the exact prompt?).
2. Report the **partitioned cookie** findings and which APIs are available.
3. Report the observed `onChanged` behaviour on an edit, and your proposed undo model.
4. Confirm the permission set can be `cookies` + `storage` + optional hosts.
5. Flag anything here you believe is wrong or infeasible.

Then implement **Phase 0** only, and report.
