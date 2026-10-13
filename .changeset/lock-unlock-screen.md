---
'@xcwds/plugin-lock': minor
'@xcwds/plugin-settings': minor
'@xcwds/create': minor
---

`@xcwds/plugin-lock` finishes the passcode lock: Settings → Privacy sets one up (6+ digits or a passphrase, with a backup offered first), picks what it locks (private pages or the whole app) and when it locks itself after the app is hidden (right away, 1, 5 or 15 minutes), and offers Lock now, Change passcode, Turn off and Forgot passcode. Locked pages go to a new unlock screen (`UnlockScreen.svelte`, at the `unlock` option's path, `/unlock` by default), which then opens the page that was asked for; every page load starts locked, and the page stays hidden until the app knows it isn't locked. Add `@xcwds/plugin-lock/styles.css` and an unlock route file. `@xcwds/plugin-settings` hides backup, import and clear while the app is locked, and `xcwds add lock` adds the unlock route.
