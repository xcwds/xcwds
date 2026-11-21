# @xcwds/plugin-notion

## 0.1.1

### Patch Changes

- 15954d5: Reformat Svelte components for prettier-plugin-svelte 4.2, which puts element content on its own lines. Svelte 5 trims whitespace at the start and end of an element, so nothing renders differently. Apps from `npm create @xcwds` with the scanner get the same layout.

## 0.1.0

### Minor Changes

- bf2a590: First release of `@xcwds/plugin-vault` (sensitive data, files and backups encrypted with `@xcwds/plugin-lock`'s passcode), `@xcwds/plugin-recorder` (voice recordings kept in the app, the microphone on only while recording), `@xcwds/plugin-scanner` (paper documents scanned to a PDF on the device, with no metadata) and `@xcwds/plugin-notion` (Notion pages downloaded through a relay you deploy and read offline).
