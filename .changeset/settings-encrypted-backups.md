---
'@xcwds/plugin-settings': minor
---

Backups come from `app.storage.exportBackup()`, so with `@xcwds/plugin-vault` they carry the sensitive groups encrypted (#79). Importing one asks for the passcode it was made with to bring those back too; without it, or in an app without the vault, the rest imports.
