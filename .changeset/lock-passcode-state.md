---
'@xcwds/core': minor
'@xcwds/plugin-lock': minor
---

Storage entries can be `sensitive: true`, which marks their group `sensitive` in `storage.groups()`. `@xcwds/plugin-lock` adds `app.lock`, the passcode lock's state: set up, unlock, lock, change, turn off, and a reset that clears the sensitive groups. Only a PBKDF2 verifier is saved, with a growing wait after 5 wrong tries; the unlock screen and Settings controls follow.
