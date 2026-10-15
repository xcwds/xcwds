# @xcwds/plugin-settings

## 0.4.0

### Minor Changes

- 7d0de97: Blob collections join storage groups: `storage.groups()` lists each group's `collections`, and a sensitive collection makes its group sensitive. Settings → Your data shows each group's files and their size and clears them with the group (and with Clear all data); a passcode lock's reset clears sensitive collections. Collections are looked up by key, so a copy (a Svelte `$state` proxy) works. `setupApp` takes a `blobs` backend, and `@xcwds/testing` keeps blobs in memory, shared by an app's tabs.

### Patch Changes

- 2c0f5e2: Prefixed storage entries for keys made at runtime (#157): `app.storage.entry(name, { prefix: true, … })` claims every key under `app:<namespace>:<name>:`, each checked by the same `parse`. `entry.at(id)` is the exact entry for one id (for `read`, `write`, `update` and `persist()`), and `storage.keys(entry)` lists the saved ids. Backups, groups, clearing, a lock's reset, migrations and other tabs' changes cover every id, and an exact entry can't overlap a prefixed one. Settings → Your data counts a prefixed entry's ids, and `@xcwds/plugin-vault` seals them when the group is sensitive.
- Updated dependencies [7d0de97]
- Updated dependencies [501c723]
- Updated dependencies [2c0f5e2]
- Updated dependencies [7a12c31]
- Updated dependencies [0e9c638]
- Updated dependencies [d5aa738]
  - @xcwds/core@0.4.0
  - @xcwds/sveltekit@0.4.0
  - @xcwds/plugin-shell@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [a5a2c8f]
- Updated dependencies [8c4940e]
- Updated dependencies [55dd748]
- Updated dependencies [29be2bb]
  - @xcwds/plugin-shell@0.3.0
  - @xcwds/sveltekit@0.3.0
  - @xcwds/core@0.3.0

## 0.2.0

### Minor Changes

- 8163df3: Entries can stay out of backups: `app.storage.entry(name, { backup: false })` is left out of exports, and imports neither write nor clear it (secrets such as access tokens, caches that can be downloaded again). Clearing its group still removes it, and the settings page's Your data marks it "Not in backups".
- ef0812a: `@xcwds/plugin-lock` finishes the passcode lock: Settings → Privacy sets one up (6+ digits or a passphrase, with a backup offered first), picks what it locks (private pages or the whole app) and when it locks itself after the app is hidden (right away, 1, 5 or 15 minutes), and offers Lock now, Change passcode, Turn off and Forgot passcode. Locked pages go to a new unlock screen (`UnlockScreen.svelte`, at the `unlock` option's path, `/unlock` by default), which then opens the page that was asked for; every page load starts locked, and the page stays hidden until the app knows it isn't locked. Add `@xcwds/plugin-lock/styles.css` and an unlock route file. `@xcwds/plugin-settings` hides backup, import and clear while the app is locked, and `xcwds add lock` adds the unlock route.
- b2909f3: New `@xcwds/plugin-lock`: on private pages (`private: true` routes), a cover over the app in the app switcher and no spellcheck, autocomplete or autocapitalize in text fields, with a "Cover private pages in the app switcher" switch in Settings → Privacy. `@xcwds/plugin-settings` shows fields in the `privacy` section inside its Privacy card, and `xcwds add lock` adds the plugin.
- 09ef8da: `width: 'split'` now lays the settings page out in two columns of cards once 50rem fits, and a new `groups` option names and orders Your data's storage groups.

### Patch Changes

- 378f9d5: `@xcwds/core` is now a peer dependency, so an app always has one kernel, even after core moves
  to a new minor before a plugin is re-released. Apps already depend on `@xcwds/core` directly (the
  starter adds it). Every first-party plugin also declares `core` in its metadata, so an app on an
  incompatible core gets `XCWDS_ERR_PLUGIN_VERSION_MISMATCH` at boot instead of a broken page.
- 6b25d5a: Saved data is no longer hidden or lost when storage is full. A migration that can't be saved keeps its migrated data in memory, so reads and backups still see it, and saves it with the version on the next write that fits. A "replace" import that runs out of room puts the previous data back, and the settings page says so.
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
  - @xcwds/plugin-shell@0.2.0

## 0.1.0

### Minor Changes

- 1924274: Routes can be `split` wide: narrow until wide screens, then room for two columns (the shell's
  `page-split` utility). Tools take a `width`, and the settings page takes `width` and `emoji: ''`
  (no emoji in its header).
- 71e1cf1: The settings page: every plugin's settings with built-in controls, sections plugins add, backups
  (download, share, import with a preview, clear per group or all) and About.
- b03ad2e: Never phone home, enforced: plugins' `network` metadata is checked when they load
  (`XCWDS_ERR_PLUGIN_META`), the build fails on any origin in the built site that no plugin
  declares and `privacy.allowOrigins` doesn't list (naming the plugin), the CSP allows only the
  declared origins, `privacy.allowOrigins` also takes `wss:` origins, development builds warn when
  a query string carries saved data (`savedDataInQuery`), and the settings page has a Privacy
  section listing what each plugin contacts.

### Patch Changes

- 1d8bbc1: The repository moved to [xcwds/xcwds](https://github.com/xcwds/xcwds): package metadata, READMEs and
  the README of apps made with `npm create @xcwds` link there.
- Updated dependencies [94e846b]
- Updated dependencies [9cb54f8]
- Updated dependencies [71e1cf1]
- Updated dependencies [1924274]
- Updated dependencies [1924274]
- Updated dependencies [1924274]
- Updated dependencies [058e876]
- Updated dependencies [8c78037]
- Updated dependencies [71e1cf1]
- Updated dependencies [b03ad2e]
- Updated dependencies [1d8bbc1]
- Updated dependencies [71e1cf1]
- Updated dependencies [8c78037]
- Updated dependencies [94e846b]
- Updated dependencies [d1dd001]
- Updated dependencies [058e876]
- Updated dependencies [28d0b17]
- Updated dependencies [e8d705f]
  - @xcwds/core@0.1.0
  - @xcwds/sveltekit@0.1.0
  - @xcwds/plugin-shell@0.1.0
