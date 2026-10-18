# @xcwds/plugin-lock

## 0.4.1

### Patch Changes

- b6b97b5: Unlocking after a page redirected itself on load (a bookmark to a private app, opened while locked) now goes on to the private page it asked for, not to `/`. The first page's guards no longer run once the page has already navigated away, and plugin-lock ignores a page's late `afterNavigate` once the app has moved on.
- Updated dependencies [b6b97b5]
  - @xcwds/sveltekit@0.5.1

## 0.4.0

### Patch Changes

- Updated dependencies [5775a2b]
  - @xcwds/sveltekit@0.5.0

## 0.3.0

### Minor Changes

- 7d0de97: Blob collections join storage groups: `storage.groups()` lists each group's `collections`, and a sensitive collection makes its group sensitive. Settings → Your data shows each group's files and their size and clears them with the group (and with Clear all data); a passcode lock's reset clears sensitive collections. Collections are looked up by key, so a copy (a Svelte `$state` proxy) works. `setupApp` takes a `blobs` backend, and `@xcwds/testing` keeps blobs in memory, shared by an app's tabs.

### Patch Changes

- Updated dependencies [7d0de97]
- Updated dependencies [501c723]
- Updated dependencies [2c0f5e2]
- Updated dependencies [d5aa738]
  - @xcwds/core@0.4.0
  - @xcwds/sveltekit@0.4.0

## 0.2.0

### Minor Changes

- a5a2c8f: While the app is locked, notices from a page the lock keeps out hide what they say (#77): `@xcwds/plugin-shell`'s toasts read "Private page" and `@xcwds/plugin-timers`' alerts "Timer finished" (the timers list shows "Private timer"), and timers still ring, snooze and stop. Toasts and timers record the page they came from (`path`; timers saved before this have none and show normally), and `app.lock.hides(path)` says whether to hide one.

### Patch Changes

- Updated dependencies [8c4940e]
- Updated dependencies [55dd748]
- Updated dependencies [29be2bb]
  - @xcwds/sveltekit@0.3.0
  - @xcwds/core@0.3.0

## 0.1.0

### Minor Changes

- 9894dfd: Storage entries can be `sensitive: true`, which marks their group `sensitive` in `storage.groups()`. `@xcwds/plugin-lock` adds `app.lock`, the passcode lock's state: set up, unlock, lock, change, turn off, and a reset that clears the sensitive groups. Only a PBKDF2 verifier is saved, with a growing wait after 5 wrong tries; the unlock screen and Settings controls follow.
- ef0812a: `@xcwds/plugin-lock` finishes the passcode lock: Settings → Privacy sets one up (6+ digits or a passphrase, with a backup offered first), picks what it locks (private pages or the whole app) and when it locks itself after the app is hidden (right away, 1, 5 or 15 minutes), and offers Lock now, Change passcode, Turn off and Forgot passcode. Locked pages go to a new unlock screen (`UnlockScreen.svelte`, at the `unlock` option's path, `/unlock` by default), which then opens the page that was asked for; every page load starts locked, and the page stays hidden until the app knows it isn't locked. Add `@xcwds/plugin-lock/styles.css` and an unlock route file. `@xcwds/plugin-settings` hides backup, import and clear while the app is locked, and `xcwds add lock` adds the unlock route.
- b2909f3: New `@xcwds/plugin-lock`: on private pages (`private: true` routes), a cover over the app in the app switcher and no spellcheck, autocomplete or autocapitalize in text fields, with a "Cover private pages in the app switcher" switch in Settings → Privacy. `@xcwds/plugin-settings` shows fields in the `privacy` section inside its Privacy card, and `xcwds add lock` adds the plugin.

### Patch Changes

- Updated dependencies [eb3be18]
- Updated dependencies [da6e2df]
- Updated dependencies [378f9d5]
- Updated dependencies [8163df3]
- Updated dependencies [61623c5]
- Updated dependencies [9894dfd]
- Updated dependencies [6b25d5a]
- Updated dependencies [54329f6]
  - @xcwds/sveltekit@0.2.0
  - @xcwds/core@0.2.0
