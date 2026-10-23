# CookieDesk 1.1.0: Chrome Web Store submission

Everything the Chrome Web Store developer dashboard asks for, in the order of its
tabs, ready to paste. Character counts are checked by `npm run listing-check`.
Limits marked *(verify)* come from the docs as of 2026-10-22; the live dashboard wins.

---

## 0. Before you start (once)

- [ ] A Chrome Web Store developer account (one-time registration fee) *(verify current fee)*.
- [ ] 2-Step Verification on that Google account (required to publish) *(verify)*.
- [ ] A verified contact email in the dashboard's Account page.
- [ ] Optional: a "trader / non-trader" declaration where your region requires it *(verify)*.

## 1. Package

| Item | Value |
|---|---|
| File to upload | `dist/cookiedesk-1.1.0.zip` (`npm run build`) |
| Contents | `manifest.json`, `_locales/`, `src/`, `icons/` only. No tests, docs or dev scripts. |
| Manifest version | 3 |
| Version | 1.1.0 |
| Minimum Chrome | 119 (`minimum_chrome_version`) |
| Install-time warnings | None (`chrome.management.getPermissionWarningsByManifest` returns `[]`; covered by acceptance test 12) |

## 2. Store listing tab

### Title (from manifest `name`, max 75 characters): 56 characters

```
Cookie Editor — View, Edit & Delete Cookies | CookieDesk
```

### Summary (from manifest `description`, max 132 characters): 119 characters

```
Inspect, edit, add and delete cookies per site. Search, import/export, partitioned-cookie support. No ads, no tracking.
```

### Description (plain text; no Markdown is rendered; max about 16,000 characters *(verify)*)

Paste everything between the lines.

---

CookieDesk is a cookie editor for developers, testers and anyone who wants to see what a website stores. View cookies, edit cookies, add and delete cookies, and search them, in a popup or a side panel. You choose which.

WHAT SETS IT APART

• Partitioned cookie editor. Chrome hides partitioned (CHIPS) cookies from tools that don't ask for them, so other cookie editors silently show an incomplete list. CookieDesk lists them next to normal cookies, each labelled with its partition.
• Undo on every change. Edits, deletes, imports and set restores are written to an undo journal first and checked after. If Chrome refuses a change, everything rolls back and you're told why. One click puts a cookie back exactly as it was, for 10 minutes; in the rare case an undo copy can't be kept, CookieDesk asks before going ahead.
• Cookie editor with no ads, no tracking and no network requests. Open source, so you can check every line.
• Per-site permission. Installing shows no "read and change all your data on all websites" prompt. You allow CookieDesk one site at a time, see every site you've allowed, and remove any with one click.

VIEW COOKIES

• A cookie viewer for every cookie of the current site: name, value, domain, path and expiry, with badges for HttpOnly, Secure, SameSite, session and partitioned cookies.
• HttpOnly cookies are clearly marked "not visible to page JavaScript".
• Real search: filter by name, value or domain as you type, even with a hundred cookies.
• Live view: see which cookies the site sets or changes while you use it.
• "What this cookie does": every flag explained in plain English, including whether the value is a JSON Web Token and when that token expires.

EDIT COOKIES

• Edit HttpOnly cookies and every other field: name, value, domain, path, expiry, Secure, HttpOnly, SameSite and partition.
• Mistakes are caught before Chrome sees them. SameSite=None without Secure, a __Host- cookie on a subdomain, an expiry in the past: the rule is explained next to the field.
• Long values such as JWTs never break the layout; copy any value with one key.
• Protect important cookies so bulk delete, import and set restore leave them alone.

DELETE COOKIES

• Delete one cookie, or every cookie the search shows, after a list of exactly what will go. Undoable for 10 minutes.

A COOKIE MANAGER FOR REAL WORKFLOWS

• Cookie sets: save a site's cookies as a named file (for example "logged in as admin") and restore it later. CookieDesk shows what will change before it does anything, and keeps no copy itself.
• Compare: see what logging in did (which cookies were added, removed or changed) between a saved set and now, or between two sets.
• Copy cookies between your normal and incognito windows (after you turn on "Allow in Incognito" for CookieDesk).
• Import and export JSON or Netscape cookies.txt, or copy cookies as a document.cookie snippet. Exports warn you that the file contains live session cookies and should be treated like a password.
• Keyboard-first: / to search, arrows to move, Enter to edit, c to copy, p to protect, Del to delete, Ctrl+Z to undo, ? for the full list.

PRIVACY

CookieDesk collects nothing and sends nothing anywhere. No analytics, no accounts, no sync, no remote code. CookieDesk keeps no cookie values on disk of its own: undo copies live in memory and are gone when Chrome closes. (Cookies you copy into your normal store are, like any cookie there, saved by Chrome.) Settings and usage counts are stored locally. The source code is public under the MIT licence.

Available in 51 languages.

Requires Chrome 119 or later.

Not affiliated with Cookie-Editor or EditThisCookie.

---

### Category

Developer Tools

### Language

Default: English (United States). The extension ships 51 locales, so the dashboard offers a listing per language: open `store-listings/paste-helper.html` (built by `npm run paste-helper`) and paste each language's description with its Copy button. Title and summary come from each locale's `extension_name` and `extension_description` automatically.

### Graphic assets

| Asset | Required | Size | File |
|---|---|---|---|
| Store icon | Yes | 128×128 PNG (96×96 artwork inside transparent padding) | `icons/icon-128.png` (also inside the zip) |
| Screenshots | At least 1, up to 5 | 1280×800 | `store/screenshots/1-list.png` … `5-access.png` |
| Small promo tile | Optional | 440×280 PNG or JPEG | `store/promo-small.png` |
| Marquee promo tile | Optional | 1400×560 PNG or JPEG | `store/promo-marquee.png` |
| YouTube video | Optional | — | none |

Screenshots in upload order (the dashboard has no caption field; the text is in the image):

1. `1-list.png`: "Every cookie, partitioned ones included"
2. `2-editor.png`: "Every flag, explained in plain words"
3. `3-undo.png`: "Undo on every change"
4. `4-compare.png`: "See what a login changed"
5. `5-access.png`: "Access one site at a time"

All screenshots are taken from the real extension (`npm run store-screens`) on `shop.example`, a reserved fictitious domain served locally, with made-up cookie values.

### Additional fields

| Field | Value |
|---|---|
| Official URL | Leave empty (it needs a site verified in Search Console). |
| Homepage URL | `https://github.com/iliasselbarhoumi/cookiedesk` |
| Support URL | `https://github.com/iliasselbarhoumi/cookiedesk/issues` |
| Mature content | Off |

## 3. Privacy tab

### Single purpose

```
CookieDesk lets you view, search, edit, add, delete, import and export the browser cookies of the sites you allow.
```

### Permission justifications (one box per permission)

**cookies**
```
Required to list, edit, add, delete, import and export cookies, which is the extension's single purpose. It reads and changes cookies only on sites the user has allowed.
```

**storage**
```
Saves settings in chrome.storage.local (whether the toolbar button opens the popup or the side panel, and which cookies the user marked as protected, by name, domain, path and partition only, never values; protections of incognito cookies stay in memory), plus usage counts used to time a rating or tip request (install time, number of successful changes, active days; numbers and times only, no sites or cookie data), and keeps in-memory undo copies in chrome.storage.session. The session copies are never written to disk, expire after 10 minutes, and are gone when Chrome closes.
```

**activeTab**
```
After the user clicks the toolbar button, it gives the popup the active tab's address so CookieDesk can name the site and ask permission for it. It grants no cookie access by itself, and it replaces the broader "tabs" permission.
```

**sidePanel**
```
Lets the user choose a side panel instead of the popup as the place CookieDesk opens.
```

**Host permissions** (`optional_host_permissions: ["<all_urls>"]`)
```
Not granted at install. Requested at runtime, one site at a time and only when the user clicks to allow it, as *://*.example.com/* so that cookies set on the site's parent domain and non-Secure cookies are included. An optional "Allow on all sites" exists for users who want it. The user can see and revoke every grant inside the extension.
```

### Remote code

```
No, I am not using remote code.
```

All code ships in the package. There are no remote scripts, no `eval`, and no network requests (`test/unit/no-network.test.mjs` guards this).

### Data usage

Does CookieDesk collect any of these? Leave **every box unchecked**:

- Personally identifiable information
- Health information
- Financial and payment information
- Authentication information
- Personal communications
- Location
- Web history
- User activity
- Website content

Why unchecked, for your own records: CookieDesk reads cookies (which can be authentication information) only to show and edit them on the user's own device. Nothing is collected, transmitted or shared. The Web Store's "collect" means transmitting off the device.

Certify all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

```
https://github.com/iliasselbarhoumi/cookiedesk/blob/main/PRIVACY.md
```

## 4. Distribution tab

| Field | Value |
|---|---|
| Payments | Free (no in-app purchases) |
| Visibility | Public |
| Regions | All regions |

## 5. Test instructions tab (optional; recommended for a cookie extension)

```
No account or credentials are needed.

1. Open any site that sets cookies, for example https://www.wikipedia.org/.
2. Click the CookieDesk toolbar button. The popup says it has no access yet: click "Allow on wikipedia.org" and accept Chrome's prompt ("Read and change your data on all wikipedia.org sites").
3. The site's cookies are listed. Click one to edit it; "What this cookie does" explains it. Delete one with the trash icon, then click Undo in the toast.
4. ⋯ menu > Access & settings lists the allowed site; its × button revokes it and the list returns to "no access".
5. The heart icon and "Support on Ko-fi" open ko-fi.com in a new tab when clicked; they are optional tips and unlock nothing.
6. Optional: DevTools on the popup (right-click > Inspect) > Network shows no requests during all of the above.

The extension makes no network requests and has no remote code. Source: https://github.com/iliasselbarhoumi/cookiedesk
```

## 6. Notes for review, if asked

- **Why `cookies` with optional `<all_urls>`?** The cookies API only works on hosts the extension may access. Requesting hosts at runtime, one site at a time, is the narrowest model that works. Exact-origin grants hide parent-domain and non-Secure cookies (`phase0/FINDINGS.md` §1).
- **Why `activeTab` instead of `tabs`?** It gives the address of the tab the user clicked on, nothing more, and has no install warning.
- **No content scripts, no `scripting`, no `webNavigation`, no `tabs`, no `alarms`.**
- **Single purpose:** everything in the extension is viewing or changing the allowed sites' cookies.

## 7. After submitting

- [ ] Tag the release: `v1.1.0` on GitHub, with the zip attached.
- [ ] When the item is live, add its Web Store link to the README.
