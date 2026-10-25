# @xcwds/plugin-install

## 0.8.0

### Minor Changes

- Needs `@xcwds/sveltekit` 0.7 (peer range `^0.7.0`).

### Patch Changes

- Updated dependencies [b3d3376]
  - @xcwds/sveltekit@0.7.0

## 0.7.0

### Minor Changes

- Needs `@xcwds/core` 0.5 (peer range `^0.5.0`).
- Needs `@xcwds/sveltekit` 0.6 (peer range `^0.6.0`).

### Patch Changes

- Updated dependencies [715bcae]
- Updated dependencies
  - @xcwds/core@0.5.0
  - @xcwds/sveltekit@0.6.0

## 0.6.0

### Minor Changes

- 90d5d26: The Install card is now a card like the settings page's others, and its words can be set once in the config: `install({ text: { heading, intro, install, iosSteps, menu } })` (also `app.install.text`; a card's `text` prop still wins). `settings({ fields: [...] })` orders fields within their section; fields left out follow in the order plugins added them.

### Patch Changes

- Updated dependencies [b6b97b5]
  - @xcwds/sveltekit@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [5775a2b]
  - @xcwds/sveltekit@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [7d0de97]
- Updated dependencies [501c723]
- Updated dependencies [2c0f5e2]
- Updated dependencies [d5aa738]
  - @xcwds/core@0.4.0
  - @xcwds/sveltekit@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [8c4940e]
- Updated dependencies [55dd748]
- Updated dependencies [29be2bb]
  - @xcwds/sveltekit@0.3.0
  - @xcwds/core@0.3.0

## 0.2.0

### Patch Changes

- 378f9d5: `@xcwds/core` is now a peer dependency, so an app always has one kernel, even after core moves
  to a new minor before a plugin is re-released. Apps already depend on `@xcwds/core` directly (the
  starter adds it). Every first-party plugin also declares `core` in its metadata, so an app on an
  incompatible core gets `XCWDS_ERR_PLUGIN_VERSION_MISMATCH` at boot instead of a broken page.
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

## 0.1.0

### Minor Changes

- 149fe4f: Install support: an early `beforeinstallprompt` caught by the head script, `app.install`
  (state, `subscribe()`, `prompt()`), platform checks (`isIos()`, `isStandalone()`) and
  `<InstallCard>` with an Install button or Add to Home Screen steps, hidden once installed.

### Patch Changes

- 71e1cf1: With `@xcwds/plugin-settings`, these plugins show up on the settings page: the theme and timer
  alarm as built-in controls, the shell's nav setting with `NavPicker`, and the install card at the
  top.
- 1d8bbc1: The repository moved to [xcwds/xcwds](https://github.com/xcwds/xcwds): package metadata, READMEs and
  the README of apps made with `npm create @xcwds` link there.
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
