---
'@xcwds/core': patch
'@xcwds/plugin-settings': patch
---

Saved data is no longer hidden or lost when storage is full. A migration that can't be saved keeps its migrated data in memory, so reads and backups still see it, and saves it with the version on the next write that fits. A "replace" import that runs out of room puts the previous data back, and the settings page says so.
