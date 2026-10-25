---
'@xcwds/plugin-offline': minor
'@xcwds/plugin-tools': minor
---

The Apps page says what each app keeps offline (#163). With `offline({ byApp: true })`, `app.offline.usage()` asks the worker how many of each app's pages its cache holds and their size, and the browser how much the app stores in all (`navigator.storage.estimate()`). The worker now handles its messages one at a time, so an answer counts the pages of an app turned on just before. `@xcwds/plugin-tools`' `AppCatalog.svelte` shows it on each card ("Kept offline: 2 pages, 14 KB") and above the list.
