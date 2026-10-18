---
'@xcwds/plugin-lock': patch
'@xcwds/sveltekit': patch
---

Unlocking after a page redirected itself on load (a bookmark to a private app, opened while locked) now goes on to the private page it asked for, not to `/`. The first page's guards no longer run once the page has already navigated away, and plugin-lock ignores a page's late `afterNavigate` once the app has moved on.
