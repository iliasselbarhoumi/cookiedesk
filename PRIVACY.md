# CookieDesk privacy policy

Effective date: 2026-10-23

CookieDesk collects nothing and transmits nothing.

- No data collection, no analytics, no telemetry, no crash reporting.
- No accounts and no sign-in.
- No network requests of any kind. Cookie values never leave your browser.
- No remote code. Everything the extension runs ships in the package.
- No ads and no sale or sharing of data, because there is no data.

## What CookieDesk reads

With your per-site permission, CookieDesk reads and changes the cookies of the site you choose, only in order to show and edit them. It also reads the address of the active tab after you click the toolbar button, to know which site to ask permission for.

## What is stored on your device

- **Settings** in `chrome.storage.local`: your choice of what the toolbar button opens (popup or side panel), and the cookies you mark as protected, recorded by name, domain, path and partition only (never their values). Your granted sites are kept by Chrome as the extension's site permissions, and you can remove them on the CookieDesk Access screen or at `chrome://extensions`.
- **Usage counts** in `chrome.storage.local`, so CookieDesk can ask for a rating or a tip at a sensible moment instead of at random: when CookieDesk was installed, how many changes it has made successfully, on how many different days, and when it last made one or showed an error. These are numbers and times only, with no site names and no cookie data. The answers you give to those asks ("Later", "Yes, I did") are kept the same way.
- **Undo copies** in `chrome.storage.session`: copies of the cookies you just changed or deleted, including their values, so undo can restore them. This storage is in memory only and is never written to disk. It keeps at most the last 20 actions for 10 minutes. Copies are deleted when Chrome closes, when the incognito session they belong to ends, or after 10 minutes once CookieDesk next runs. CookieDesk has no background timer, so with no CookieDesk page open, expired copies can remain in memory until the next wake-up or until Chrome closes.

Nothing else is stored.

## Links that open a web page

The heart and "Buy me a coffee" open https://ko-fi.com/buildwithiliass, and "Rate CookieDesk" opens CookieDesk's page on the Chrome Web Store, each in a new tab, only when you click them. CookieDesk sends nothing to these sites; what they receive is what any visit sends.

## Exports

Export, "Save cookie set" and "Copy as document.cookie" write a file to your computer, or text to your clipboard, only when you ask. "Copy shown cookies to another store" writes cookies into the store you choose, only when you ask; cookies copied from an incognito window into your normal store are then kept by Chrome like any other cookie. The file contains live cookie values, so treat it like a password. CookieDesk warns you before exporting. It never uploads the file.

## Contact

Questions or concerns: open an issue at https://github.com/iliasselbarhoumi/cookiedesk/issues.
