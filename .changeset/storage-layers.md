---
'@xcwds/core': minor
---

Storage layers: `app.storage.layer((inner) => adapter)` lets a plugin wrap the storage adapter (to keep some keys encrypted, for example), and `app.storage.reload()` re-reads saved data after a layer's view of it changes. A layer throws `XCWDS_ERR_LOCKED` (the new `codes.LOCKED`) for keys it can't serve while locked.
