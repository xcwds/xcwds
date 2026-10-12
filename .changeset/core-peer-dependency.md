---
'@xcwds/plugin-changelog': patch
'@xcwds/plugin-install': patch
'@xcwds/plugin-offline': patch
'@xcwds/plugin-settings': patch
'@xcwds/plugin-share': patch
'@xcwds/plugin-shell': patch
'@xcwds/plugin-theme': patch
'@xcwds/plugin-timers': patch
'@xcwds/plugin-tools': patch
'@xcwds/plugin-update': patch
'@xcwds/sveltekit': patch
'@xcwds/testing': patch
---

`@xcwds/core` is now a peer dependency, so an app always has one kernel, even after core moves
to a new minor before a plugin is re-released. Apps already depend on `@xcwds/core` directly (the
starter adds it). Every first-party plugin also declares `core` in its metadata, so an app on an
incompatible core gets `XCWDS_ERR_PLUGIN_VERSION_MISMATCH` at boot instead of a broken page.
