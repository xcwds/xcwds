# @xcwds/plugin-shell

## 0.8.0

### Minor Changes

- Needs `@xcwds/sveltekit` 0.8 (peer range `^0.8.0`).

### Patch Changes

- Updated dependencies [3eccb4f]
  - @xcwds/sveltekit@0.8.0

## 0.7.0

### Minor Changes

- Needs `@xcwds/sveltekit` 0.7 (peer range `^0.7.0`).

### Patch Changes

- Updated dependencies [b3d3376]
  - @xcwds/sveltekit@0.7.0

## 0.6.0

### Minor Changes

- Needs `@xcwds/core` 0.5 (peer range `^0.5.0`).
- Needs `@xcwds/sveltekit` 0.6 (peer range `^0.6.0`).

### Patch Changes

- Updated dependencies [715bcae]
- Updated dependencies
  - @xcwds/core@0.5.0
  - @xcwds/sveltekit@0.6.0

## 0.5.0

### Minor Changes

- 5775a2b: Need SvelteKit 3 (the `@sveltejs/kit` peer range is now `^3.0.0`), like `@xcwds/sveltekit` (#57).

### Patch Changes

- Updated dependencies [5775a2b]
  - @xcwds/sveltekit@0.5.0

## 0.4.0

### Minor Changes

- 7a12c31: A shell section can belong to an app (`sections[].app`, #159): it's hidden in the tab bar, header links and sidebar while that app is off, from first paint, and comes back when it's turned on in any tab. `@xcwds/plugin-tools` sets `data-apps-off` on `<html>` (before first paint too) and checks that each section's app is one of its `apps`.
- 0e9c638: `app.shell.setTitle(text)` titles the page showing now, for pages whose title isn't known at build time (part of #160). The header shows it, and `<title>` too unless the route is private; it holds for that path only.

### Patch Changes

- Updated dependencies [7d0de97]
- Updated dependencies [501c723]
- Updated dependencies [2c0f5e2]
- Updated dependencies [d5aa738]
  - @xcwds/core@0.4.0
  - @xcwds/sveltekit@0.4.0

## 0.3.0

### Minor Changes

- a5a2c8f: While the app is locked, notices from a page the lock keeps out hide what they say (#77): `@xcwds/plugin-shell`'s toasts read "Private page" and `@xcwds/plugin-timers`' alerts "Timer finished" (the timers list shows "Private timer"), and timers still ring, snooze and stop. Toasts and timers record the page they came from (`path`; timers saved before this have none and show normally), and `app.lock.hides(path)` says whether to hide one.

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
