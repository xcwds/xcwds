# @xcwds/core

## 0.2.0

### Minor Changes

- 8163df3: Entries can stay out of backups: `app.storage.entry(name, { backup: false })` is left out of exports, and imports neither write nor clear it (secrets such as access tokens, caches that can be downloaded again). Clearing its group still removes it, and the settings page's Your data marks it "Not in backups".
- 9894dfd: Storage entries can be `sensitive: true`, which marks their group `sensitive` in `storage.groups()`. `@xcwds/plugin-lock` adds `app.lock`, the passcode lock's state: set up, unlock, lock, change, turn off, and a reset that clears the sensitive groups. Only a PBKDF2 verifier is saved, with a growing wait after 5 wrong tries; the unlock screen and Settings controls follow.

### Patch Changes

- da6e2df: Backups import again after a plugin with migrations is removed: its data is kept as unclaimed together with its schema version, and is migrated from that version if the plugin comes back (#51). Deleting the last of a removed plugin's data also deletes its schema version.
- 61623c5: Kernel and integration edge cases (#58):

  - `satisfies()` compares prerelease tags identifier by identifier (`beta.2` < `beta.10`) and supports hyphen ranges (`1.2.3 - 2.0.0`); a plugin whose `core` range can't be read fails with a clear "unsupported range" error instead of a version mismatch.
  - `hasDecorator()` no longer counts `Object.prototype` names (`toString`, `isPrototypeOf`…) as decorators.
  - Other tabs' storage listeners no longer see the `probe` key `storage.writable()` writes.
  - `app.load()` documents that a failed load keeps rejecting, so the app must be recreated.
  - An `onNavigate` guard answer that isn't an app path (`//host/…`, `https://…`) stops the navigation and goes to `onError` instead of leaving the app.

- 6b25d5a: Saved data is no longer hidden or lost when storage is full. A migration that can't be saved keeps its migrated data in memory, so reads and backups still see it, and saves it with the version on the next write that fits. A "replace" import that runs out of room puts the previous data back, and the settings page says so.

## 0.1.0

### Minor Changes

- 94e846b: `app.hooks.reduce()` passes a value through every hook in order, each able to replace it (for
  `onConfig` and `onManifest`), and `app.hooks.firstNow()` is `first()` answering synchronously
  while the hooks do (for navigation guards).
- 9cb54f8: The kernel: plugins with avvio-style loading and Fastify-style encapsulation, three hook families,
  typed decorators, config validation with manifest and head tags, icon rendering, namespaced
  storage with migrations and backups, and plugin-extensible settings with a pre-paint script.
- 71e1cf1: Settings fields take a `control` (choice, switch, number or switches) and a `hint` for settings
  pages. Storage groups are labelled by their entries, and this tab's `clear()` and `importData()`
  reach `onChange` listeners too.
- 1924274: `storage.appName` sets the name backups carry and must carry to import (default: `brand.name`), so
  an app moving onto @xcwds keeps importing the backups it made before.
- b03ad2e: Never phone home, enforced: plugins' `network` metadata is checked when they load
  (`XCWDS_ERR_PLUGIN_META`), the build fails on any origin in the built site that no plugin
  declares and `privacy.allowOrigins` doesn't list (naming the plugin), the CSP allows only the
  declared origins, `privacy.allowOrigins` also takes `wss:` origins, development builds warn when
  a query string carries saved data (`savedDataInQuery`), and the settings page has a Privacy
  section listing what each plugin contacts.

### Patch Changes

- 1d8bbc1: The repository moved to [xcwds/xcwds](https://github.com/xcwds/xcwds): package metadata, READMEs and
  the README of apps made with `npm create @xcwds` link there.
