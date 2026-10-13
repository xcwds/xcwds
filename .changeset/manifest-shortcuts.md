---
'@xcwds/sveltekit': patch
---

A config's `manifest.shortcuts` no longer replaces the shortcuts plugins add in `onManifest` (such as `@xcwds/plugin-tools`' `shortcut: true` tools): the config's come first, then the plugins'. Every other `manifest` field still overrides what plugins set.
