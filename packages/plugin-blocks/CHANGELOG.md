# @xcwds/plugin-blocks

## 0.6.1

### Patch Changes

- ea91b11: With `@xcwds/plugin-vault`, private apps no longer vanish while the app is locked: Your apps shows "N private apps, locked" and Utils a "Private apps" tool, both leading to the unlock screen and back to Your apps. Only the number is kept outside the encryption. A link to a sealed private app on the normal page asks for the passcode too.

## 0.6.0

### Minor Changes

- Needs `@xcwds/sveltekit` 0.8 (peer range `^0.8.0`).

### Patch Changes

- Updated dependencies [3eccb4f]
  - @xcwds/sveltekit@0.8.0

## 0.5.0

### Minor Changes

- Needs `@xcwds/sveltekit` 0.7 (peer range `^0.7.0`).

### Patch Changes

- Updated dependencies [b3d3376]
  - @xcwds/sveltekit@0.7.0

## 0.4.0

### Minor Changes

- Needs `@xcwds/core` 0.5 (peer range `^0.5.0`).
- Needs `@xcwds/sveltekit` 0.6 (peer range `^0.6.0`).

### Patch Changes

- Updated dependencies [715bcae]
- Updated dependencies
  - @xcwds/core@0.5.0
  - @xcwds/sveltekit@0.6.0

## 0.3.0

### Minor Changes

- 5775a2b: Need SvelteKit 3 (the `@sveltejs/kit` peer range is now `^3.0.0`), like `@xcwds/sveltekit` (#57).

### Patch Changes

- Updated dependencies [5775a2b]
  - @xcwds/sveltekit@0.5.0

## 0.2.0

### Minor Changes

- 0df1c20: Make your own apps: `<AppBuilder>` (at `<path>/edit` and, for private apps, `<path>/private-edit`) builds a new app from checklists, counters, logs and notes, or edits one, asking before a change removes saved data. Your apps gets New app, an app's page gets Edit app, and `app.blocks.editPathOf` gives the builder's page.
- 2cf1770: The builder keeps your unsaved changes (`app.blocks.draft` / `saveDraft`, never backed up, private ones in the private group) until Save or Discard changes, has a Preview that works without saving anything, and says Saved once the app really is.
- 3a0df7c: Editing an app: `dataLoss` says what a changed definition would drop (removed blocks and fields, changed types, values that no longer fit), and saving an app removes that data instead of keeping it hidden. Also `blankApp`, `blankBlock`, `blankField` and `move` for the builder.
- 1e3e1c4: Share an app's design: Share design (on Your apps and in the builder) offers a link, Copy link and Save as file, with the app's blocks but never what's saved in them, and asks first for a private app. `<ImportApp>` at `<path>/import` opens a shared link or file, lists every block and field, and adds a copy on Add app. The design travels in the link's fragment, compressed, so it never reaches a server.

## 0.1.0

### Minor Changes

- 2cb06ac: First release: small apps people add from templates (checklists, counters, logs with charts, notes), defined as data rather than code, with Your apps and the pages that run them.
