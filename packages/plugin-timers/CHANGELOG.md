# @xcwds/plugin-timers

## 0.8.0

### Minor Changes

- Needs `@xcwds/plugin-shell` 0.8 (peer range `^0.8.0`).
- Needs `@xcwds/sveltekit` 0.8 (peer range `^0.8.0`).

### Patch Changes

- Updated dependencies
- Updated dependencies [3eccb4f]
  - @xcwds/plugin-shell@0.8.0
  - @xcwds/sveltekit@0.8.0

## 0.7.0

### Minor Changes

- Needs `@xcwds/plugin-shell` 0.7 (peer range `^0.7.0`).
- Needs `@xcwds/sveltekit` 0.7 (peer range `^0.7.0`).

### Patch Changes

- Updated dependencies
- Updated dependencies [b3d3376]
  - @xcwds/plugin-shell@0.7.0
  - @xcwds/sveltekit@0.7.0

## 0.6.0

### Minor Changes

- Needs `@xcwds/core` 0.5 (peer range `^0.5.0`).
- Needs `@xcwds/plugin-shell` 0.6 (peer range `^0.6.0`).
- Needs `@xcwds/sveltekit` 0.6 (peer range `^0.6.0`).

### Patch Changes

- Updated dependencies [715bcae]
- Updated dependencies
- Updated dependencies
  - @xcwds/core@0.5.0
  - @xcwds/plugin-shell@0.6.0
  - @xcwds/sveltekit@0.6.0

## 0.5.0

### Minor Changes

- 5775a2b: Need SvelteKit 3 (the `@sveltejs/kit` peer range is now `^3.0.0`), like `@xcwds/sveltekit` (#57).

### Patch Changes

- Updated dependencies [5775a2b]
- Updated dependencies [5775a2b]
  - @xcwds/plugin-shell@0.5.0
  - @xcwds/sveltekit@0.5.0

## 0.4.0

### Patch Changes

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

### Minor Changes

- a5a2c8f: While the app is locked, notices from a page the lock keeps out hide what they say (#77): `@xcwds/plugin-shell`'s toasts read "Private page" and `@xcwds/plugin-timers`' alerts "Timer finished" (the timers list shows "Private timer"), and timers still ring, snooze and stop. Toasts and timers record the page they came from (`path`; timers saved before this have none and show normally), and `app.lock.hides(path)` says whether to hide one.

### Patch Changes

- Updated dependencies [a5a2c8f]
- Updated dependencies [8c4940e]
- Updated dependencies [55dd748]
- Updated dependencies [29be2bb]
  - @xcwds/plugin-shell@0.3.0
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
  - @xcwds/plugin-shell@0.2.0

## 0.1.0

### Minor Changes

- 336f9d0: Timers that count against wall-clock end times and are saved, so they survive a backgrounded
  tab and a reload; the app owns them, so they ring, keep the screen awake and hold off updates on
  every page. With `TimerList`, `Countdown` and `TimerAlert` components and an `alarm` setting.

### Patch Changes

- 1924274: `<html data-hydrated>` is set once the app has booted, so tests that wait for it never act before
  plugins follow the browser's events. `<TimerAlert>` no longer re-renders itself in a loop while a
  timer rings, and takes an `openLabel` for its Open link. The config also loads in a fresh checkout, before `svelte-kit sync` has written the
  `.svelte-kit/tsconfig.json` an app's tsconfig extends.
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
