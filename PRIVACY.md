# CookieDesk privacy policy

Effective date: 2026-10-22

CookieDesk collects nothing and transmits nothing.

- No data collection, no analytics, no telemetry, no crash reporting.
- No accounts and no sign-in.
- No network requests of any kind. Cookie values never leave your browser.
- No remote code. Everything the extension runs ships in the package.
- No ads and no sale or sharing of data, because there is no data.

## What CookieDesk reads

With your per-site permission, CookieDesk reads and changes the cookies of the site you choose, only in order to show and edit them. It also reads the address of the active tab after you click the toolbar button, to know which site to ask permission for.

## What is stored on your device

- **Settings** in `chrome.storage.local`: your choice of what the toolbar button opens (popup or side panel). Your granted sites are kept by Chrome as the extension's site permissions, and you can remove them on the CookieDesk Access screen or at `chrome://extensions`.
- **Undo copies** in `chrome.storage.session`: copies of the cookies you just changed or deleted, including their values, so undo can restore them. This storage is in memory only and is never written to disk. It keeps at most the last 20 actions for 10 minutes. Copies are deleted when Chrome closes, when the incognito session they belong to ends, or after 10 minutes once CookieDesk next runs. CookieDesk has no background timer, so with no CookieDesk page open, expired copies can remain in memory until the next wake-up or until Chrome closes.

Nothing else is stored.

## Exports

Export writes a file to your computer only when you ask. The file contains live cookie values, so treat it like a password. CookieDesk warns you before exporting. It never uploads the file.

## Contact

Questions or concerns: open an issue at <REPO_URL>/issues.
