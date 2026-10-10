# @xcwds/plugin-update

## 0.1.0

### Minor Changes

- 1924274: Updates hand values over to the new version (`app.update.carry()` and `handover()`), under a
  `marker` key an app can keep from before @xcwds. What's new uses it to know what the old version
  had: entries newer than that are new, and a fresh install neither badges nor saves anything.
- e8d705f: Updates on the user's terms: a new version installs and waits until Update is tapped,
  `app.update` (state, `check()`, `markBusy()`, `busyReasons()` with `onBeforeReload` hooks,
  `apply()`, `reload()`), other tabs reload quietly when hidden and idle or ask otherwise, and
  `<UpdateBanner>`. Options: `checkEveryMs` and `askBeforeReload`.

### Patch Changes

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
