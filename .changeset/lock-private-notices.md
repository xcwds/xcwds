---
'@xcwds/plugin-lock': minor
'@xcwds/plugin-shell': minor
'@xcwds/plugin-timers': minor
---

While the app is locked, notices from a page the lock keeps out hide what they say (#77): `@xcwds/plugin-shell`'s toasts read "Private page" and `@xcwds/plugin-timers`' alerts "Timer finished" (the timers list shows "Private timer"), and timers still ring, snooze and stop. Toasts and timers record the page they came from (`path`; timers saved before this have none and show normally), and `app.lock.hides(path)` says whether to hide one.
