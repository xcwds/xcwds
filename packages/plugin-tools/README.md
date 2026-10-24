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
- **`items`**: the tools, each `{ path, name, emoji, blurb, private?, shortcut?, width?, app? }`. A
  tool's route gets its name as the title and the index page as its back target. Its `width` is
  `narrow` (the default), `wide` for a list-style tool (a grid of cards), or `split` for a tool
  laid out in two columns on wide screens.
- **`private: true`** keeps a tool out of Recently used, the Share button (its route is marked
  `private`) and the manifest. Use it for personal tools, and keep their names and emoji
  discreet: the index page and pinned tools still show them, and the app may be open on a
  shared screen.
- **`shortcut: true`** adds the tool to the manifest's `shortcuts` (the home-screen icon's
  long-press menu), after any `manifest.shortcuts` in your config.
- **`storageKey`**: where pins and recents are saved (default `app:tools:shortcuts`). Set it to
  keep a key your app already uses, e.g. `app:home:shortcuts` for an app moving from
  xcwds.github.io's own code, so users keep their pins.

- **`apps`** and **`catalog`** (default `/apps`): apps people turn on and off; see below.

## Apps people turn on and off

An app with many tools can group them into apps (Kitchen, Gym, ...) so each person keeps only
the ones they use:

```ts
tools({
	path: '/utils',
	apps: [
		{
			id: 'kitchen',
			name: 'Kitchen',
			emoji: '🍳',
			blurb: 'Recipes and timers.',
			routes: ['/recipes'],
			groups: ['recipes']
		},
		{ id: 'gym', name: 'Gym', emoji: '🏋️', blurb: 'Lifting.', default: false }
	],
	items: [
		{
			path: '/utils/coffee-timer',
			emoji: '☕',
			name: 'Coffee Timer',
			blurb: '90 s.',
			app: 'kitchen'
		}
	]
});
```

- Each app is `{ id, name, emoji, blurb, private?, default?, routes?, groups? }`. A tool joins
  one with `app: '<id>'`; a tool with no `app` always shows, so without `apps` nothing changes.
- **`default`** (true unless set) is whether a fresh install starts with it on. **`private`**
  makes every tool in it private. **`routes`** (path prefixes) are other pages it owns, and
  **`groups`** the storage groups that hold its data.
- The Apps page (`catalog`) is a thin route file rendering `AppCatalog.svelte` in
  `<main class="page-wide">`. Each card has the app's tools and an On/Off switch. Once an app
  is off and has saved data in its `groups`, the card offers Remove data, which asks first and
  clears those groups (not while a passcode lock is locked). The index page links to it.
- Turning an app off only hides it: its tools leave the index page and Home (pins and recents
  are kept and come back with it), and its pages still open. Put `AppOffNotice.svelte` in the
  shell's `notices` to say so on those pages, with a Turn on button.
- Which apps are on is the `apps` setting (`{ [id]: boolean }`; a missing id means the app's
  `default`, and choosing the default removes the id), so it's in backups and follows other tabs.
  With `@xcwds/plugin-settings` it shows as a link to the Apps page.
- A shell section can belong to an app (`sections[].app` in `@xcwds/plugin-shell`) and hides
  while it's off. The `apps` field's pre-paint script sets `data-apps-off` on `<html>` (the ids
  of the apps that are off) before first paint, and the page keeps it up to date.
- The manifest's `shortcuts` are written at build time for everyone, so only tools of apps that
  start on (`default` not false) become shortcuts.
- The service worker gets `app.tools` too (the `./worker` entry): every tool and app from the
  options, each app as it starts, so a worker plugin can tell which app a page belongs to
  (`appOf`). Whether an app is on lives in the page's settings, which a worker can't read:
  `@xcwds/plugin-offline`'s `byApp` has the page send it.

## Home and the page entry

With `@xcwds/plugin-shell`, Home shows Pinned (in your order, with Edit to move or unpin) and
Recently used (the last three tools opened, newest first, leaving out pinned and private ones).
Opening a tool records it (`afterNavigate`), quietly: if storage is blocked, nothing is
reported, while a pin that can't be saved shows the shell's "Couldn't save" toast. Both are
saved as `app:tools:shortcuts` (see `storageKey`); tools that no longer exist are dropped when it's read.

`app.tools` in the page has `list()` (the tools that show), `all()`, `get(path)`, `index`,
`catalog`, `apps()`, `appOf(path)`, `isOn(id)`, `setOn(id, on)`, `subscribe(listener)` (apps
turned on or off, and tools added or removed after boot), `add(tool)`, `remove(path)` and `shortcuts` (`state`, `subscribe`, `togglePin`, `movePin`, `visit`,
`reload`); `HomeShortcuts.svelte` is the Home
block, should you lay out Home yourself.

## Tools from other plugins

A plugin adds its own tool with `app.tools?.add(tool)` while plugins register, from both its
build entry (which adds the tool's page to the route registry, so the plugin doesn't call
`app.route()` for it) and its page entry. Register it after `tools()` in the config. A tool with
no route (added from the page entry only) logs a warning when the app starts.

### Tools on a shared page

Some tools share one page and come and go with the person's data, like the apps of
`@xcwds/plugin-blocks` at `/my-apps/app#<id>`. Their `path` ends with a `#fragment` (1-64
letters, digits, `-`, `_`, `.` or `~`), which tells them apart in pins and Recently used:
opening `/my-apps/app#k3f9` records that tool, and any other fragment records the page. The
build adds no route for them (the plugin that owns the page registers it), and the page entry can
`add()` them at any time; lists, Home and `subscribe` follow. `update(tool)` replaces the one at
the same path (a new name or emoji) and keeps its pin; `remove(path)` takes one away with its pin
and its place under Recently used. Since such tools may be added after the saved
shortcuts load (once the data is read, or after an unlock), pins and recents with a fragment
are kept while their tool is missing, and Home shows only the ones that are there.
