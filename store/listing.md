# CookieDesk: Chrome Web Store listing

## Title (becomes manifest "name"; cap 75; 56 characters)

Cookie Editor — View, Edit & Delete Cookies | CookieDesk

## Short description (cap 132; 119 characters)

Inspect, edit, add and delete cookies per site. Search, import/export, partitioned-cookie support. No ads, no tracking.

## Category

Developer Tools

## Long description (plain text)

CookieDesk is a cookie editor for developers, testers and anyone who wants to see what a site stores. View cookies, edit cookies, add and delete cookies, and search them, in a popup or a side panel. You choose which.

What sets it apart

- Partitioned cookie editor. Chrome hides partitioned (CHIPS) cookies from tools that don't ask for them. CookieDesk lists them next to normal cookies, each labelled with its partition.
- Real search. Filter by name, value or domain as you type, even on sites with dozens of cookies.
- Cookie editor, no ads. No ads, no banners, no tracking, no network requests. Cookie editor open source: the code is public so you can check.

What you can do

- Cookie viewer for every cookie on the current site, with secure, HttpOnly, session and partitioned badges.
- Edit HttpOnly cookies. They are marked "not visible to page JavaScript".
- Edit every field: name, value, domain, path, expiry, Secure, HttpOnly, SameSite. Illegal combinations are blocked before writing, with the rule explained.
- Undo on every change: edit, add, delete, import. Undo works for 10 minutes; undo copies stay in memory only, never on disk, and are gone when Chrome closes.
- Import and export cookies as JSON or cookies.txt. Export warns you that the file contains live session cookies and should be treated like a password. Imports are checked first and written all or nothing.
- Incognito and other cookie stores, selectable.
- Honest empty states: no cookies, no access yet, or a page Chrome doesn't allow. Never a blank list without a reason.

Permissions you can read

CookieDesk asks for access one site at a time. Installing shows no "read and change all your data on all websites" prompt. When you allow a site, Chrome says "Read and change your data on all example.com sites", because a site's cookies often belong to its parent domain. Allowing all sites is optional. Every grant is listed and removable inside the extension.

A cookie manager that stays out of your way: no accounts, no sync, no analytics.

Not affiliated with Cookie-Editor or EditThisCookie.

## Single purpose

CookieDesk lets you view, search, edit, add, delete, import and export the browser cookies of the sites you allow.

## Permission justifications (CWS dashboard)

- cookies: Required to list, edit, add, delete, import and export cookies, which is the extension's single purpose. It reads and changes cookies only on sites the user has allowed.
- storage: Saves one setting (whether the toolbar button opens the popup or the side panel) in chrome.storage.local, and keeps in-memory undo copies in chrome.storage.session. The session copies are never written to disk, expire after 10 minutes, and are gone when Chrome closes.
- activeTab: After a toolbar click, gives the popup the active tab's URL so it can name the site and ask permission for it. It grants no cookie access.
- sidePanel: Lets the user choose a side panel instead of the popup as the place CookieDesk opens.
- Host permissions (optional, optional_host_permissions <all_urls>): Not granted at install. Requested at runtime, per site and only when the user clicks to allow, as *://*.example.com/* so that cookies set on the site's parent domain and non-Secure cookies are included. An opt-in "Allow on all sites" also exists. The user can revoke each grant in the extension.

## Remote code

No. All code ships in the package. There are no remote scripts, no eval of fetched content, and no network requests.

## Data usage disclosure

Does the extension collect user data: No. Leave every data-type box unchecked (personally identifiable information, health, financial, authentication information, personal communications, location, web history, user activity, website content).

Certifications (check all three):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: <REPO_URL>/blob/main/PRIVACY.md

## Screenshot captions

1. Partitioned and normal cookies, listed with badges
2. Cookie editor with rules checked before saving
3. Undo toast right after deleting a cookie
4. Per-site access screen, each grant removable
5. Side panel in dark mode
