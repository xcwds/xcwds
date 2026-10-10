# @xcwds/core

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
