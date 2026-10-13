# @xcwds/plugin-lock

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
