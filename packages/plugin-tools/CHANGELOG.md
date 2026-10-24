# @xcwds/plugin-tools

## 0.8.0

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

## 0.7.0

### Minor Changes

- ac67559: A tool can set `width: 'wide'` for a list-style page (a grid of cards), as well as `narrow` and `split`.

### Patch Changes

- Updated dependencies [b6b97b5]
  - @xcwds/sveltekit@0.5.1

## 0.6.0

### Minor Changes

- 5775a2b: Need SvelteKit 3 (the `@sveltejs/kit` peer range is now `^3.0.0`), like `@xcwds/sveltekit` (#57).

### Patch Changes

- Updated dependencies [5775a2b]
- Updated dependencies [5775a2b]
  - @xcwds/plugin-shell@0.5.0
  - @xcwds/sveltekit@0.5.0

## 0.5.0

### Minor Changes

- ada9231: `app.tools.update(tool)` replaces a tool added at runtime in place (a new name or emoji), keeping its pin and its place under Recently used.

### Patch Changes

- ada9231: With `apps`, the page entry boots in Node (unit tests with `buildTestApp`) instead of failing on the missing `document`.

## 0.4.0

### Minor Changes

- 7a12c31: A shell section can belong to an app (`sections[].app`, #159): it's hidden in the tab bar, header links and sidebar while that app is off, from first paint, and comes back when it's turned on in any tab. `@xcwds/plugin-tools` sets `data-apps-off` on `<html>` (before first paint too) and checks that each section's app is one of its `apps`.
- 04875cf: Apps people turn on and off (#158): group tools into `apps`, each with its own pages (`routes`) and data (`groups`). The new Apps page (`AppCatalog.svelte`) has a switch per app and Remove data for an app that's off. Tools of apps that are off leave Home and the index page (pins are kept), and their pages show `AppOffNotice.svelte` with a Turn on button. `app.tools` gains `all()`, `apps()`, `appOf()`, `isOn()`, `setOn()`, `subscribe()` and `catalog`, and the `apps` setting holds which apps are on.
- aeffd6d: Tools on a shared page (part of #160): a tool's `path` can end with a `#fragment` (`/my-apps/app#k3f9`), which pins and Recently used tell apart. The page entry can `app.tools.add()` such tools at any time and `app.tools.remove(path)` them with their pin, `subscribe` follows both, and their saved pins are kept while the tool isn't there yet.

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

- 1924274: Routes can be `split` wide: narrow until wide screens, then room for two columns (the shell's
  `page-split` utility). Tools take a `width`, and the settings page takes `width` and `emoji: ''`
  (no emoji in its header).
- 058e876: A tool registry: an index page, each tool's page in the route registry, pinned and recently used
  tools on Home, manifest shortcuts, and private tools kept out of recents, sharing and the
  manifest. Other plugins add tools with `app.tools.add()`.

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
