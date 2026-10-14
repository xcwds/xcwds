---
'@xcwds/core': minor
'@xcwds/plugin-lock': minor
'@xcwds/plugin-settings': minor
'@xcwds/sveltekit': patch
'@xcwds/testing': patch
---

Blob collections join storage groups: `storage.groups()` lists each group's `collections`, and a sensitive collection makes its group sensitive. Settings → Your data shows each group's files and their size and clears them with the group (and with Clear all data); a passcode lock's reset clears sensitive collections. Collections are looked up by key, so a copy (a Svelte `$state` proxy) works. `setupApp` takes a `blobs` backend, and `@xcwds/testing` keeps blobs in memory, shared by an app's tabs.
