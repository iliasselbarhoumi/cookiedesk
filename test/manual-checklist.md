# CookieDesk acceptance checklist (BUILD_SPEC_COOKIE.md §9)

All 21 acceptance tests from the spec, grouped as in §9. Automated tests are run by the commands below; the rest need a real Chrome with the unpacked extension loaded.

## How to run

- `npm test` runs the unit suite (`node --test test/unit/`), including `test/unit/no-network.test.mjs` (the zero-network and no-console static guard).
- `npm run test:e2e` runs the engine, UI and robustness end-to-end suites against a real Chrome profile.
- `npm run test:old-chrome` covers test 5 on Chrome for Testing 116, 119 and 131 (`npm run get-old-chrome` downloads them once).
- `npm run test:permissions` covers tests 13–15 with real permission prompts. A visible Chrome opens and you click Allow twice.
- `node phase0/run.mjs --interactive` drives real Chrome permission prompts, which the automated suites cannot show.

## Notes from phase0/FINDINGS.md

- **Test 8:** The automated case is "Chrome rejects the new half of a rename", not a forced `set` failure. `set()` is atomic, so a failed `set` destroys nothing. The key-change path is `set(new)` then `remove(old)`, so a failure of the remove half is rolled back (covered in `test/unit/engine.test.mjs`).
- **Test 20:** The 4 KB limit applies to **name + value** combined, at most 4096 bytes. 4096 bytes is accepted. 4097 is refused before writing.

- **Undo** (spec §8, §13 "no sequence of actions destroys a cookie without an undo"): undo refuses with `undo_conflict` when a cookie changed after the edit, and goes ahead only on explicit confirmation. Covered in both suites, along with write-ahead journaling, concurrent edits, redo, and expired restores.

## Completeness — the release gate (P-1, P-6)

| # | Test | How | Status |
|---|------|-----|--------|
| 1 | A site with both normal and `Partitioned` cookies → **both** listed, partitioned ones labelled with their key. *(The 2M incumbent fails this.)* | Automated: `test/e2e/engine.e2e.mjs` (test 1) and `test/unit/engine.test.mjs` (list test for test 1) | PASS (automated: engine + `ui.e2e.mjs` labels and HttpOnly callout) |
| 2 | A site where permission has not been granted → the empty state says so and offers the grant button. **Never a bare empty list.** | Phase 2/3 — manual. 1) Load the unpacked extension (`chrome://extensions` → Developer mode → Load unpacked → select the repo root). 2) Open a normal https site with cookies, e.g. a site you have not granted yet. 3) Open CookieDesk from the toolbar or side panel. 4) Confirm the empty state says that permission is not granted for this site and shows a grant button. 5) Confirm there is never a blank list with no explanation. | PASS (automated: `ui.e2e.mjs`) |
| 3 | `chrome://extensions` and the Web Store → explained, not apparently broken. | Phase 2/3 — manual. 1) Open CookieDesk on `chrome://extensions`. 2) Confirm the UI explains that Chrome internal pages cannot be inspected. 3) Repeat on `https://chromewebstore.google.com`. 4) Confirm the explanation is shown in both cases and the UI does not look broken. | PASS (automated: `ui.e2e.mjs` for chrome://extensions; Web Store classification unit-tested, not opened live) |
| 4 | A site with 40+ cookies → search filters by name, value and domain live. | Phase 2/3 — manual. 1) Open a site with 40+ cookies (or set up 40+ with the add-cookie feature). 2) Type part of a cookie name into search; confirm the list narrows without pressing Enter. 3) Clear it, then search by a fragment of a value, then by a domain. 4) Confirm each search filters live across name, value and domain. | PASS (automated: `ui.e2e.mjs`, 45+ cookies) |
| 5 | Chrome older than the partition APIs (if testable) → feature-detected, note shown, no crash. | Automated: `npm run get-old-chrome && npm run test:old-chrome` (`test/e2e/old-chrome.e2e.mjs`) on real Chrome for Testing 116, 119 and 131, plus unit tests for `probeFeatures`. Chrome 116 returns partitioned cookies unlabelled and an edit writes an unpartitioned twin (FINDINGS §8), so `minimum_chrome_version` is 119 and 116 refuses to load the extension. | PASS (automated: 116 refuses to install; 119 and 131 list and label partitioned cookies, edit in place, undo, no errors) |

## Safety of editing (§5.4)

| # | Test | How | Status |
|---|------|-----|--------|
| 6 | Edit a cookie's value → exactly one logical change; list does not flicker or duplicate; `onChanged` double-fire is absorbed. | Automated: `test/e2e/engine.e2e.mjs` (test 6) and `test/unit/engine.test.mjs` (tests 6, change listener). | PASS (automated: one change event, unchanged rows keep their DOM nodes) |
| 7 | Edit a cookie to an illegal combination (`sameSite: 'no_restriction'` with `secure: false`) → **blocked before writing**, rule explained. The original cookie still exists. | Automated: `test/e2e/engine.e2e.mjs` (test 7) and `test/unit/engine.test.mjs` (test 7). | PASS (automated: blocked in the editor, rule shown, original intact) |
| 8 | Force the `set` half to fail → the original is restored automatically and the user is told. **No silent loss.** | Automated: `test/e2e/engine.e2e.mjs` (test 8, Chrome rejects the new half of a rename) and `test/unit/engine.test.mjs` (test 8, both rename cases). | PASS (automated) |
| 9 | Set an expiry in the past → UI states plainly that this deletes the cookie. | Automated: `test/e2e/engine.e2e.mjs` (test 9) and `test/unit/engine.test.mjs` (test 9). | PASS (automated: "Saving with an expiry in the past deletes this cookie.") |
| 10 | Delete a cookie → undo restores it byte-identically, including `httpOnly`, `secure`, `sameSite`, path and expiry. | Automated: `test/e2e/engine.e2e.mjs` (test 10) and `test/unit/engine.test.mjs` (test 10). | PASS (automated: row delete + toast undo, byte-identical) |
| 11 | Edit a session cookie on a site you are logged into → you stay logged in unless you changed something that should log you out. | Automated: `test/e2e/engine.e2e.mjs` (test 11). | PASS (automated) |

## Permissions (P-4, §5.2)

| # | Test | How | Status |
|---|------|-----|--------|
| 12 | Fresh install → the prompt does **not** request all-sites access. | Phase 2/3 — manual. 1) Remove any existing CookieDesk install. 2) Go to `chrome://extensions`, Developer mode on, Load unpacked, select the repo root. 3) Read the install dialog: it must list no permissions, and must not say "read and change all your data on all websites". 4) Confirm `chrome://extensions` → CookieDesk → Details shows no "Site access: all sites" entry. | PASS (automated: Chrome reports zero warnings for the shipped manifest); confirm the dialog visually once |
| 13 | Grant one origin → cookies readable and writable there, and nowhere else. | Phase 2/3 — manual. 1) Open `https://example.com` (or a site you use) and grant CookieDesk access to that site from the UI. 2) Confirm its cookies are listed and editable. 3) Open a different site, confirm it is not readable (shows the grant-needed state). 4) Confirm `chrome://extensions` shows the site under granted site access only. | Ready to run: `npm run test:permissions` (you click Allow) |
| 14 | Revoke that origin → list empties with the correct explanation. | Phase 2/3 — manual. 1) With a granted site open in CookieDesk, revoke its access from the UI. 2) Confirm the list empties. 3) Confirm the message explains that access was revoked for this site (not that the site has no cookies). | Ready to run: `npm run test:permissions` |
| 15 | "Grant all sites" opt-in → works, and the granted list reflects it. | Phase 2/3 — manual. 1) Use the "Grant all sites" opt-in and accept Chrome's prompt. 2) Open two different sites and confirm both are readable and editable. 3) Open the granted list in CookieDesk and confirm it shows all sites as granted. 4) Revoke and confirm the list returns to per-site behaviour. | Ready to run: `npm run test:permissions` |

## Stores and robustness

| # | Test | How | Status |
|---|------|-----|--------|
| 16 | Incognito window (with incognito access enabled) → its separate cookie store is selectable and correct. | Phase 2/3 — manual. 1) In `chrome://extensions`, enable "Allow in Incognito" for CookieDesk. 2) Set one cookie for a test site in a normal window, and a different value for the same site in an incognito window. 3) In CookieDesk, select the incognito store (store id `1`, not `0`) and confirm it shows the incognito value only. | PASS (automated: `robustness.e2e.mjs`, a real incognito window gets its own store, the UI selects and edits only that store, and its undo copies are purged when the window closes) |
| 17 | Service worker terminated mid-session → UI recovers, granted origins intact. | Phase 2/3 — manual. 1) Grant access to a site and open CookieDesk on it. 2) In `chrome://serviceworker-internals` (or `chrome://extensions` → "Inspect views: service worker"), stop the CookieDesk service worker. 3) Interact with the UI (search or edit a cookie). 4) Confirm the UI recovers without a reload and the site is still granted. | PASS (automated: `robustness.e2e.mjs`, worker killed then edit, undo, grants and surface setting all still work) |
| 18 | Export then import on a clean profile → identical cookie set, all flags preserved. Export shows the security warning. | Automated: `test/e2e/engine.e2e.mjs` (test 18, export then import with all flags). The security-warning text on export is not covered by the automated test; check it manually in the export dialog. | PASS (automated: warning dialog, download, clean-profile import) |
| 19 | Import a malformed/hostile JSON file → rejected with a specific message, no partial write. | Automated: `test/e2e/engine.e2e.mjs` (test 19) and `test/unit/engine.test.mjs` (import all-or-nothing and validate-before-write tests). | PASS (automated: engine, plus three hostile files through the UI; nothing written) |
| 20 | A cookie with a 4KB value → renders, copies and edits without breaking. | Automated: `test/e2e/engine.e2e.mjs` (test 20) and `test/unit/engine.test.mjs` (4 KB edit test). The limit is name + value ≤ 4096 bytes. | PASS (automated: no overflow in popup or 320 px panel; editor shows 4006 / 4096) |
| 21 | DevTools Network tab across a full session → **zero requests.** | Phase 2/3 — manual. 1) Load the unpacked extension, open DevTools on the CookieDesk side panel (or popup) → Network tab, and clear it. 2) Perform a full session: grant a site, list, search, edit, delete, undo, export, import. 3) Confirm the Network tab shows zero requests. Also run `npm test` (includes the static no-network guard in `test/unit/no-network.test.mjs`). | PASS (automated: zero requests during a UI session + static guard over src/); a manual DevTools look is still worthwhile |

## Also covered (Phase 3 robustness)

- **Popup closed mid-import:** the undo button offers "Undo interrupted: Imported 151 cookies" and restores the store exactly.
- **Hostile cookie names, values and paths** (`<script>`, `onerror=`, `"><svg …>`) render as inert text: no elements, no requests, no dialogs.
- **An import that writes to other sites** lists every site, never truncated, and Import stays disabled until you tick "Also write cookies for N other sites".
- **A full jar** renders and searches quickly. Chrome keeps about 180 cookies per site; the test uses 1 KB values plus a partitioned third party.
- **Undo is scoped to its cookie store:** an incognito change is never shown or undone from a regular window.
