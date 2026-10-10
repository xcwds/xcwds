# @xcwds/plugin-shell

## 0.1.0

### Minor Changes

- 1924274: Routes can be `split` wide: narrow until wide screens, then room for two columns (the shell's
  `page-split` utility). Tools take a `width`, and the settings page takes `width` and `emoji: ''`
  (no emoji in its header).
- 058e876: Home always shows the app's name and tagline above the blocks plugins add, and a failed save
  (`app.storage.onSaveFailure`) shows one "Couldn't save on this device" toast.
- 8c78037: The app shell: header with title and back arrow, a tab bar on phones and header links or a
  sidebar on wider screens (the `nav` setting, applied before first paint), toasts
  (`app.toast`), Home blocks and header actions (`app.shell`), an error page, `<NavPicker>`, and
  Tailwind v4 styles with page containers and an accessibility baseline.

### Patch Changes

- 71e1cf1: With `@xcwds/plugin-settings`, these plugins show up on the settings page: the theme and timer
  alarm as built-in controls, the shell's nav setting with `NavPicker`, and the install card at the
  top.
- 1d8bbc1: The repository moved to [xcwds/xcwds](https://github.com/xcwds/xcwds): package metadata, READMEs and
  the README of apps made with `npm create @xcwds` link there.
- 71e1cf1: Home blocks and header actions no longer re-create every component whenever a plugin adds or
  removes one, so their state (and anything they do on mount) survives.
- Updated dependencies [94e846b]
- Updated dependencies [9cb54f8]
- Updated dependencies [71e1cf1]
- Updated dependencies [1924274]
- Updated dependencies [1924274]
- Updated dependencies [1924274]
- Updated dependencies [b03ad2e]
- Updated dependencies [1d8bbc1]
- Updated dependencies [8c78037]
- Updated dependencies [94e846b]
- Updated dependencies [d1dd001]
- Updated dependencies [058e876]
- Updated dependencies [28d0b17]
- Updated dependencies [e8d705f]
  - @xcwds/core@0.1.0
  - @xcwds/sveltekit@0.1.0
