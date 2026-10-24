---
'@xcwds/plugin-lock': minor
---

With `@xcwds/plugin-vault`, "Forgot passcode" first offers an encrypted backup: only what the passcode encrypts, still encrypted, which imports only with that passcode (#79). The backup offered before setting a passcode comes from `app.storage.exportBackup()`.
