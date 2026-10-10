# @xcwds/plugin-settings

## 1.0.0

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
  - @xcwds/plugin-shell@1.0.0
