# Changelog

## 1.1.0 (2026-10-23)

**A redesigned popup and side panel**
- Icons instead of words where an icon is clear: the header (undo, add, menu), cookie badges (lock for Secure, a crossed eye for HttpOnly, a split box for partitioned, a shield for protected) and the expiry clock. Every icon has a tooltip and an accessible name.
- The ⋯ menu leads with icon tiles for export, import and cookie sets; the rest is a short icon list.
- The editor turns flags into toggle chips, shows the value's size as a bar against Chrome's 4096-byte limit, and gives each line of "What this cookie does" its own icon.
- Access & settings: sites listed with a remove button each, a Popup / Side panel switch, and a Support & feedback section.
- Clearer state screens (no access, restricted page, empty list, search with no match) with one action each, and placeholder rows while loading.
- Motion that explains what happened: rows slide in when a list appears and fold away when deleted, views slide in and back, menus and dialogs scale in, the toast shows its remaining time and pauses on hover, the undo arrow kicks when there is something new to undo. Reduced-motion settings turn all of it off.

**51 languages**
- The whole interface, every error message and "What this cookie does" are translated into the 51 languages the Chrome Web Store offers, and follow Chrome's own language. Arabic, Persian and Hebrew lay out right to left.
- Dates and relative times ("in 3 days") use your language's own format.
- The store listing has a description in each language too.

**Support and ratings**
- A heart in the header, "Support on Ko-fi" in the menu and "Buy me a coffee" in Access & settings open ko-fi.com/buildwithiliass. Nothing is locked behind it.
- A rare tip card after milestones of successful changes, and, for store installs only, a rare rating card right after CookieDesk worked for you and never soon after an error. One card at a time; "Later" backs off; both stop for good once answered. Timing rules are in the README.
- To time these, CookieDesk keeps a small usage record on your device (install time, number of successful changes, active days, last change and last error). No sites, no cookie data, nothing sent.

## 1.0.0 (2026-10-22)

First public release.

**Reading cookies**
- Lists every cookie of the current site, partitioned (CHIPS) ones included, each labelled with its partition. Third-party cookies partitioned under the site are listed once that site is allowed too, and the list says so instead of claiming to be complete.
- Live search by name, value or domain. Badges for HttpOnly ("not visible to page JavaScript"), Secure, SameSite, session and partition.
- Honest empty states: no cookies, no access yet, a page Chrome doesn't let extensions read, or a store that's gone.
- Live view: rows the site adds or changes are highlighted, and a line names what changed.
- "What this cookie does": every attribute explained in plain words, plus JWT detection with its own expiry.

**Changing cookies**
- Edit every field. Illegal combinations are blocked before writing, with the rule explained.
- Undo on every change, for 10 minutes: edit, add, delete, bulk delete, import, set restore and copy. Write-ahead journal in memory only; failures roll back completely. In the two rare cases an undo copy can't be kept (a change over 4 MB, or replacing a cookie Chrome would no longer accept as stored), CookieDesk asks first.
- Protect a cookie so bulk delete, import and set restore leave it alone.
- Delete the cookies the list shows (narrow with search first), with a list of exactly what goes.
- Cookie sets, kept as files: save the site's cookies under a name, restore them later with a preview of what changes, compare a set with now (or two sets with each other).
- Copy cookies between the normal and incognito stores (needs "Allow in Incognito").
- Import and export JSON and Netscape cookies.txt; copy as a document.cookie snippet.

**Trust**
- Asks for access one site at a time; the install prompt shows no permission warnings. "Allow on all sites" is opt-in. Every grant is listed and revocable.
- Zero network requests. No ads, analytics, telemetry or remote code.
- Cookie values are never logged and never put in a URL, and CookieDesk keeps none on disk of its own (undo copies are memory-only; cookies you copy into the normal store are saved by Chrome like any other).
- Keyboard-first: `/`, arrows, Home/End, Enter, `c`, `p`, Del, `n`, Ctrl/⌘+Z, Esc, `?`.
- Popup or side panel, light or dark, reduced motion respected.

**Requirements**
- Chrome 119 or later. Older Chrome returns partitioned cookies unlabelled and can't edit them correctly (phase0/FINDINGS.md §8), so CookieDesk won't install there.
