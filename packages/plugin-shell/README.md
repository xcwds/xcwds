# @xcwds/plugin-shell

The app shell for an @xcwds app on [`@xcwds/sveltekit`](../sveltekit), from xcwds.github.io's
root layout: a header with the page title (the page's only `<h1>`) and a back arrow, a tab bar
on phones, header links or a sidebar on tablets and computers, one stack for toasts and
notices, a Home page other plugins add to, and an error page.

```ts
// xcwds.config.ts
import { defineConfig } from '@xcwds/core';
import shell from '@xcwds/plugin-shell';

export default defineConfig({
	brand: { name: 'My app', tagline: 'Everyday tools.' },
	plugins: [
		shell({
			sections: [
				{ path: '/', label: 'Home', emoji: '🏠' },
				{ path: '/recipes', label: 'Recipes', emoji: '📖', also: ['/guide'] },
				{ path: '/settings', label: 'Settings', emoji: '⚙️' }
			]
		})
	]
});
```

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
	import Shell from '@xcwds/plugin-shell/Shell.svelte';
	import UpdateBanner from '@xcwds/plugin-update/UpdateBanner.svelte';
	import { App } from '@xcwds/sveltekit';
	import '../app.css';

	let { children } = $props();
</script>

<App>
	<Shell>
		{@render children()}
		{#snippet notices()}<UpdateBanner />{/snippet}
	</Shell>
</App>
```

```svelte
<!-- src/routes/+page.svelte -->
<script lang="ts">
	import Home from '@xcwds/plugin-shell/Home.svelte';
</script>

<Home />

<!-- src/routes/+error.svelte -->
<script lang="ts">
	import ErrorPage from '@xcwds/plugin-shell/ErrorPage.svelte';
</script>

<ErrorPage />
```

Other pages render their content in `<main class="page-narrow">` (tools, settings),
`<main class="page-wide">` (lists, Home) or `<main class="page-split @container">` (narrow until
`xl`, then wide enough for two columns, which the page lays out with `@[50rem]:` container
queries), and their route's `width` (`app.route()`, default `wide`) names the same container so
the header lines up with it. Pages don't render their own
`<h1>` or back links.

## Styles (Tailwind v4)

The components use Tailwind classes and CSS variables; Skeleton isn't needed. Tailwind doesn't
scan `node_modules`, so import the shell's CSS, which adds its `@source`:

```css
/* src/app.css */
@import 'tailwindcss';
@import '@xcwds/plugin-theme/tailwind.css'; /* optional: dark mode follows the theme setting */
@import '@xcwds/plugin-shell/styles.css';
```

It provides the `sidebar:` variant (the sidebar layout; use `md:` for anything tied to the tab
bar), the `page-narrow`, `page-wide` and `page-split` utilities, and the accessibility baseline: 44px controls
(checkboxes and radio buttons get theirs from their `<label>`), a `:focus-visible` ring and
reduced motion. Theme it by setting the `--xcwds-shell-*` and `--xcwds-toast-*` variables on
`:root` (and `:root[data-color-scheme='dark']`); see `styles.css` for the list.

## Navigation

Phones (narrower than `md`, or under 500px tall) get the tab bar. Wider screens get header links
or a sidebar per orientation, from the `nav` setting (`{ portrait, landscape }`, each `'bar'` or
`'sidebar'`; defaults: bar in portrait, sidebar in landscape). It applies before first paint as
`data-nav-portrait` / `data-nav-landscape` on `<html>`. `<NavPicker>` lets the user choose. With
one section there is no navigation at all.

The header's title, emoji and back arrow come from the route registry; a section's own page
uses its label, Home uses `brand.name`, and other pages lead back home. A section's `also`
paths (and everything under them) highlight it too.

## For plugins

- **`app.toast(message, { action?, durationMs? })`** shows a short confirmation in the stack
  (3 s, or 8 s with an action link `{ label, path, hash? }`; at most three at once). A save that
  fails (`app.storage.onSaveFailure`) shows one "Couldn't save on this device" toast. A toast
  records the page it was raised on (`path`); while [`@xcwds/plugin-lock`](../plugin-lock) has
  the app locked, one from a page it keeps out says "Private page" instead (the toaster's
  `privateText`).
- **`app.shell.home.add(Component, { props?, order? })`** adds a block to Home (lowest `order`
  first), below `brand.name` and `brand.tagline`.
- **`app.shell.header.add(Component, { props?, order? })`** adds a button beside the title.
- `app.shell.sections` and `app.shell.toasts` (`list()`, `subscribe()`, `dismiss(id)`).

Register a client plugin that uses these after the shell in the config's `plugins`, so
`app.shell` exists when it loads.
