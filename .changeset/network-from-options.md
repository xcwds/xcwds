---
'@xcwds/core': minor
'@xcwds/sveltekit': patch
'@xcwds/testing': patch
---

A plugin's `network` metadata may be a function of its options, `(options) => NetworkUse`, for origins the app picks (a relay's, say). The kernel resolves it with the options the plugin is registered with and checks the result as before (`resolveNetwork`); the build's scan, CSP, worker guard and the settings page's Privacy section use the resolved origins.
