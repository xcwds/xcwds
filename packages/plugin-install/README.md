# @xcwds/plugin-install

Install support for an @xcwds app on [`@xcwds/sveltekit`](../sveltekit): an Install button
where the browser offers one, Add to Home Screen steps on iPhone and iPad, and nothing once the
app runs installed.

```ts
// xcwds.config.ts
import { defineConfig } from '@xcwds/core';
import install from '@xcwds/plugin-install';

export default defineConfig({
	brand,
	plugins: [install({ text: { heading: 'Install My App', intro: 'Keep it on your home screen.' } })]
});
```

```svelte
<!-- Anywhere inside <App>; the settings plugin puts it on its page -->
<script lang="ts">
	import InstallCard from '@xcwds/plugin-install/InstallCard.svelte';
</script>

<InstallCard />
```

## What it does

- Chromium browsers fire `beforeinstallprompt` when the app can be installed, sometimes before
  the app's code has loaded. The build adds a line to the head script that catches it then; the
  page picks it up when it boots.
- `app.install` has `state` (`checked`, `installed`, `available`, `ios`), `subscribe(listener)`
  and `prompt()`, which shows the browser's dialog (call it from a tap; a prompt can be shown
  once) and resolves to `'accepted'`, `'dismissed'` or `'unavailable'`.
- `installed` is true when the app runs standalone (`display-mode: standalone`, or
  `navigator.standalone` on iOS), and after the browser reports `appinstalled`.
- `ios` is true on iPhone and iPad (including iPadOS, which says it's a Mac with touch), where
  there's no prompt. `isIos()` and `isStandalone()` are exported for your own checks.

`<InstallCard>` renders nothing until the checks have run (a prerendered page can't know) or
once installed. It's a card like the settings page's others (on `--xcwds-shell-card`). Change
its words with `text` (`heading`, `intro`, `install`, `iosSteps`, `menu`; `<strong>` is kept,
other markup is shown as text): the plugin's `text` option applies to every card (it's
`app.install.text`), and a card's own `text` prop wins over it. Change its button colour with
`--xcwds-install-accent`, or render your own from `app.install`.
