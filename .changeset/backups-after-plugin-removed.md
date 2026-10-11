---
'@xcwds/core': patch
---

Backups import again after a plugin with migrations is removed: its data is kept as unclaimed together with its schema version, and is migrated from that version if the plugin comes back (#51).
