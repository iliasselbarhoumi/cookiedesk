# Changelog

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
