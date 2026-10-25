# @xcwds/plugin-share

Sharing for an @xcwds app on [`@xcwds/sveltekit`](../sveltekit): a Share button in the installed
app that shares a page's link and nothing you typed, and a private share target, so other apps
can share into yours without the shared content ever reaching a server.

```ts
// xcwds.config.ts
import { defineConfig } from '@xcwds/core';
import share from '@xcwds/plugin-share';
import shell from '@xcwds/plugin-shell';

export default defineConfig({
	brand,
	// After the shell, whose header gets the button.
	plugins: [shell({ sections }), share({ target: '/utils/url-sanitizer' })]
});
```

## Options

| Option    | Default         | What it does                                                                        |
| --------- | --------------- | ----------------------------------------------------------------------------------- |
| `target`  | none            | The page that receives shares (an app path). Without it the app is no share target. |
| `exclude` | `['/settings']` | Paths (and everything under them) whose pages never show the Share button.          |
| `files`   | none            | Receive shared images too (see [Shared images](#shared-images)).                    |

## The Share button

In the installed app there's no browser toolbar to share from, so the shell's header gets a
Share button (with `@xcwds/plugin-shell`). It shares the page's title, "Title on App" (Home:
"App: tagline") and its link: origin, base path and path only, never the query or hash, which can
hold what you typed. It opens the system share sheet, or copies the link (with a toast) where
there is none. It doesn't show in a browser tab, on excluded paths, on routes marked `private`
(such as private tools from `@xcwds/plugin-tools`) or on error pages. Exclude other private
pages, such as the share target if what it shows is private.

`app.share.share({ title, text, url })` does the same from your own button.

## The share target

With `target`, the manifest gets a `share_target` (GET, `url`, `text` and `title`), so Android
lists the app in its share sheet. A share opens `target?url=…&text=…&title=…`. The service
worker answers that request itself, before it leaves the device, with a `303` to the same page
with the fields in the fragment (`#shared.url=…&shared.text=…&shared.title=…&url=<joined>`, `url` last),
which browsers never send to a server. The target page reads it and clears the address:

```svelte
<script lang="ts">
	import type { Shared } from '@xcwds/plugin-share';
	import { useApp } from '@xcwds/sveltekit';
	import { onMount } from 'svelte';

	let shared = $state<Shared | null>(null);
	onMount(() => useApp().shared?.listen((value) => (shared = value)));
</script>
```

`listen` calls back now and on every later share into an open tab (Safari may only change the
hash), and replaces the address with the bare page so nothing stays in history. `joined` is
every field joined with spaces (share sheets often put the link in `text`); `url`, `text` and
`title` are the fields as sent. An iPhone Shortcut can open `target#url=<link>` directly: everything after `url=` is the link,
decoded whole, so a raw `&` or `+` in it survives.

The first share after install can open the target before the worker controls the page (Android
may open it cold). Then the page reads the query instead and clears it the same way, but that
one request did reach the server with the query (on GitHub Pages, its logs).

## Shared images

With `files`, Android's share sheet can send images to the app too:

```ts
share({
	target: '/utils/url-sanitizer',
	files: {
		target: '/utils/photo-cleaner',
		accept: ['image/jpeg', 'image/png'],
		allowColdStartRisk: true
	}
});
```

| Option                     | Default       | What it does                                                        |
| -------------------------- | ------------- | ------------------------------------------------------------------- |
| `files.target`             | (required)    | The page that receives shared images (may be the same as `target`). |
| `files.accept`             | `['image/*']` | The image types the app takes; others are left out and counted.     |
| `files.allowColdStartRisk` | (required)    | Must be `true`: you accept the cold-start upload described below.   |

A manifest has one `share_target`, so with `files` it becomes `method: "POST"`,
`enctype: "multipart/form-data"`, sent to `files.target`, for links too. The service worker
answers that POST itself: it keeps each accepted image in the `app:share:inbox` blob collection
(sensitive, so a lock's reset clears it and `@xcwds/plugin-vault` seals it; never in backups),
then `303`s to `files.target#shared.files=<ids>&…&url=<joined>` (a share of links alone goes to
`target`, when there is one). `listen` hands the page the images as `files` (`File` objects
with their names) and deletes them from the inbox, so it holds nothing once the page has them;
`skipped` counts files that weren't kept (not an accepted type, or storage full or locked).
Anything still in the inbox after a day is cleared when the app starts.

### The cold-start upload

The worker can only answer a share once it runs. Android opens the target with a plain POST
before that, and the POST carries **the image itself** to the server the app is loaded from (on
GitHub Pages, a `405` answer, but the bytes were sent). That window can't be closed from the
page:

- **Right after install.** Chrome no longer needs a service worker to install an app, so the app
  can be installed, and shared into, before its worker has activated.
- **After the site's data is cleared** (by the person, or evicted under storage pressure). That
  removes the worker but leaves the installed app and its manifest, so the next share is
  uploaded until the app is opened again.

A navigation goes through the active worker for its scope even when no page is open (Chrome
starts the worker for it), so once the app has been opened once, shares stay on the device. Since
the window can't be shown to be closed, `files` needs `allowColdStartRisk: true`, and Settings →
Privacy (with `@xcwds/plugin-settings`) tells people that an image shared before the app has
finished setting up is uploaded to the app's host. Without `files`, link sharing stays a GET, as
above. iPhones have no Web Share Target; the Shortcut route is for links only.
