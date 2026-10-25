---
'@xcwds/plugin-share': minor
'@xcwds/plugin-settings': minor
'@xcwds/sveltekit': minor
---

Receive shared images (#148). `share({ files: { target, accept, allowColdStartRisk: true } })` makes the manifest's `share_target` a multipart POST. The service worker answers it on the device: it keeps each accepted image in the `app:share:inbox` blob collection (sensitive, out of backups) and redirects to `files.target` with their ids in the fragment, and `app.shared.listen` hands the page the images as `files` (taking them out of the inbox; anything left there is cleared after a day). A share made before the worker runs (right after install, or after the site's data was cleared) uploads the image to the server, so `files` needs `allowColdStartRisk: true`, and Settings → Privacy says so. `@xcwds/sveltekit`'s worker now passes same-origin navigations that POST to plugins' `onFetch` hooks (they went straight to the network before). `@xcwds/plugin-settings`' `app.settingsPage.add` takes `in: 'privacy'` to put a component inside the Privacy card.
