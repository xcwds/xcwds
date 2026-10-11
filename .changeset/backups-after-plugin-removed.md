---
'@xcwds/core': patch
---

Backups import again after a plugin with migrations is removed: its data is kept as unclaimed together with its schema version, and is migrated from that version if the plugin comes back (#51). Deleting the last of a removed plugin's data also deletes its schema version.
