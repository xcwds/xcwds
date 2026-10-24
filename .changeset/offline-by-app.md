---
'@xcwds/plugin-offline': minor
'@xcwds/plugin-tools': minor
'@xcwds/sveltekit': minor
---

Keeps only the apps people turned on offline (#163). `offline({ byApp: true })` leaves the pages of `@xcwds/plugin-tools`' apps out of the install precache, downloads an app's pages when it's turned on and deletes them when it's turned off, and an update precaches the apps that were on. `@xcwds/plugin-tools` has a `./worker` entry that gives the service worker `app.tools`, and `@xcwds/sveltekit/worker`'s cache policy gains `defer`, with `app.worker.deferred()` and `app.worker.scope`.
