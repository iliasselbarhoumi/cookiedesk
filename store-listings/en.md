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
