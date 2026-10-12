---
'@xcwds/core': minor
'@xcwds/plugin-settings': minor
---

Entries can stay out of backups: `app.storage.entry(name, { backup: false })` is left out of exports, and imports neither write nor clear it (secrets such as access tokens, caches that can be downloaded again). Clearing its group still removes it, and the settings page's Your data marks it "Not in backups".
