---
'@xcwds/core': minor
'@xcwds/plugin-settings': patch
---

Prefixed storage entries for keys made at runtime (#157): `app.storage.entry(name, { prefix: true, … })` claims every key under `app:<namespace>:<name>:`, each checked by the same `parse`. `entry.at(id)` is the exact entry for one id (for `read`, `write`, `update` and `persist()`), and `storage.keys(entry)` lists the saved ids. Backups, groups, clearing, a lock's reset, migrations and other tabs' changes cover every id, and an exact entry can't overlap a prefixed one. Settings → Your data counts a prefixed entry's ids, and `@xcwds/plugin-vault` seals them when the group is sensitive.
