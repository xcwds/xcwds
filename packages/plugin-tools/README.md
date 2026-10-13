# @xcwds/plugin-tools

A list of small tools for an [@xcwds](https://github.com/xcwds/xcwds) app: an index page, each
tool's own page in the route registry, the tools you pin and the ones you used last on Home, and
manifest shortcuts. Generalises xcwds.github.io's `/utils`.

```ts
// xcwds.config.ts
import shell from '@xcwds/plugin-shell';
import tools from '@xcwds/plugin-tools';

export default defineConfig({
	brand,
	plugins: [
		shell({
			sections: [
				{ path: '/', label: 'Home', emoji: '🏠' },
				{ path: '/utils', label: 'Utils', emoji: '🧰' }
			]
		}),
		tools({
			path: '/utils',
			title: 'Utils',
			emoji: '🧰',
			items: [
				{
					path: '/utils/coffee-timer',
					emoji: '☕',
					name: 'Coffee Timer',
					blurb: '90-second countdown.',
					shortcut: true
				},
				{ path: '/utils/cycle', emoji: '🌙', name: 'Cycle', blurb: 'Private notes.', private: true }
			]
		})
	]
});
```

```css
/* src/app.css, after Tailwind and the shell's styles */
@import '@xcwds/plugin-tools/styles.css';
```

The index page and each tool are thin route files in your app (RFC 0001, decision 2):

```svelte
<!-- src/routes/utils/+page.svelte -->
<script>
	import ToolList from '@xcwds/plugin-tools/ToolList.svelte';
</script>

<main class="page-wide"><ToolList /></main>
```

## Options

- **`path`** (default `/tools`), **`title`** (default `Tools`) and **`emoji`**: the index page.
- **`items`**: the tools, each `{ path, name, emoji, blurb, private?, shortcut?, width? }`. A
  tool's route gets its name as the title and the index page as its back target. Its `width` is
  `narrow` (the default) or `split`, for a tool laid out in two columns on wide screens.
- **`private: true`** keeps a tool out of Recently used, the Share button (its route is marked
  `private`) and the manifest. Use it for personal tools, and keep their names and emoji
  discreet: the index page and pinned tools still show them, and the app may be open on a
  shared screen.
- **`shortcut: true`** adds the tool to the manifest's `shortcuts` (the home-screen icon's
  long-press menu), after any `manifest.shortcuts` in your config.
- **`storageKey`**: where pins and recents are saved (default `app:tools:shortcuts`). Set it to
  keep a key your app already uses, e.g. `app:home:shortcuts` for an app moving from
  xcwds.github.io's own code, so users keep their pins.

## Home and the page entry

With `@xcwds/plugin-shell`, Home shows Pinned (in your order, with Edit to move or unpin) and
Recently used (the last three tools opened, newest first, leaving out pinned and private ones).
Opening a tool records it (`afterNavigate`), quietly: if storage is blocked, nothing is
reported, while a pin that can't be saved shows the shell's "Couldn't save" toast. Both are
saved as `app:tools:shortcuts` (see `storageKey`); tools that no longer exist are dropped when it's read.

`app.tools` in the page has `list()`, `get(path)`, `index` and `shortcuts` (`state`,
`subscribe`, `togglePin`, `movePin`, `visit`, `reload`); `HomeShortcuts.svelte` is the Home
block, should you lay out Home yourself.

## Tools from other plugins

A plugin adds its own tool with `app.tools?.add(tool)` while plugins register, from both its
build entry (which adds the tool's page to the route registry, so the plugin doesn't call
`app.route()` for it) and its page entry. Register it after `tools()` in the config. A tool with
no route (added from the page entry only) logs a warning when the app starts.
