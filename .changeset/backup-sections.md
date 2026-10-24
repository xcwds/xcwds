---
'@xcwds/core': minor
---

Backup sections (#79): `app.storage.backupSection(id, { covers, export })` lets a plugin carry some keys in a backup itself, in `sections[id]`, instead of in `data`. `app.storage.exportBackup()` (async) makes a backup with every section, as `format: 3` when one added something; `exportData()` stays the backup without sections. `parseBackup` keeps a file's sections unread for their plugin, and refuses formats other than 2 and 3. A backup now records the schema version its data is actually at, so data whose migration waits for an unlock imports through that migration later.
