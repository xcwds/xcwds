---
'@xcwds/plugin-lock': minor
---

`app.lock.keep(keeper)` hands the passcode, once checked, to something kept with it (the coming
`@xcwds/plugin-vault`'s encryption key). A keeper that can't save undoes a set-up, change or
turn-off, so `turnOff` can now resolve to a sentence, as `change` already could.
