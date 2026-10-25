# @xcwds/plugin-share

## 0.8.0

### Minor Changes

- Needs `@xcwds/plugin-shell` 0.8 (peer range `^0.8.0`).
- Needs `@xcwds/sveltekit` 0.8 (peer range `^0.8.0`).
- 3eccb4f: Receive shared images (#148). `share({ files: { target, accept, allowColdStartRisk: true } })` makes the manifest's `share_target` a multipart POST. The service worker answers it on the device: it keeps each accepted image in the `app:share:inbox` blob collection (sensitive, out of backups) and redirects to `files.target` with their ids in the fragment, and `app.shared.listen` hands the page the images as `files` (taking them out of the inbox; anything left there is cleared after a day). A share made before the worker runs (right after install, or after the site's data was cleared) uploads the image to the server, so `files` needs `allowColdStartRisk: true`, and Settings → Privacy says so. `@xcwds/sveltekit`'s worker now passes same-origin navigations that POST to plugins' `onFetch` hooks (they went straight to the network before). `@xcwds/plugin-settings`' `app.settingsPage.add` takes `in: 'privacy'` to put a component inside the Privacy card.

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

- d1dd001: Sharing: a Share button in the installed app's header that shares a page's title and link (never
  its query or hash) or copies it, and a GET share target whose service worker moves shared
  content from the query to the fragment before it leaves the device, with `app.shared.listen()`
  for the target page.

### Patch Changes

- 058e876: No Share button on private routes (e.g. a private tool).
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
