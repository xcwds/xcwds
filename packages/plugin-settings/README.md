# @xcwds/plugin-settings

The settings page for an [@xcwds](https://github.com/xcwds/xcwds) app, generalised from
xcwds.github.io's `/settings`. It shows:

- every plugin's settings, grouped by section, with built-in controls;
- whole sections other plugins add, such as Install and What's new;
- Your data: download, share or import a backup, and clear data per group or all at once;
- Privacy: the servers the app contacts and why, from each plugin's `network` metadata and
  `privacy.allowOrigins` (or that it contacts none), and every plugin's declared network use;
- About.

```ts
// xcwds.config.ts
import settings from '@xcwds/plugin-settings';

export default defineConfig({
	brand,
	plugins: [
		shell({ sections: [/* … */ { path: '/settings', label: 'Settings', emoji: '⚙️' }] }),
		settings({ source: 'https://github.com/me/my-app', backupName: 'my-app-backup' })
	]
});
```

```css
/* src/app.css, after Tailwind and the shell's styles */
@import '@xcwds/plugin-settings/styles.css';
```

```svelte
<!-- src/routes/settings/+page.svelte -->
<script>
	import SettingsPage from '@xcwds/plugin-settings/SettingsPage.svelte';
</script>

<main class="page-narrow">
	<SettingsPage>
		{#snippet about()}<p>Anything else for About.</p>{/snippet}
	</SettingsPage>
</main>
```

## Options

| Option       | Default     | What it does                                                                   |
| ------------ | ----------- | ------------------------------------------------------------------------------ |
| `path`       | `/settings` | The page (added to the route registry with `title` and `emoji`).               |
| `title`      | `Settings`  | Its title.                                                                     |
| `emoji`      | `⚙️`        | Its emoji; `''` shows none.                                                    |
| `width`      | `narrow`    | `narrow`, or `split`: two columns of cards once 50rem fits (use `page-split`). |
| `sections`   | `{}`        | Titles by section id, in the order they show (`{ tools: 'Tool defaults' }`).   |
| `groups`     | `{}`        | Your data's storage groups by id, named and in the order they show.            |
| `source`     | none        | An `https://` link to the app's source, under About.                           |
| `backupName` | `backup`    | The backup file's name before its date.                                        |

## Settings fields

A field shows when it has a `control` (plain data, so the kernel stays framework-free):

```ts
app.settings.field('alarm', {
	default: { sound: true },
	parse,
	label: 'Timer alarm',
	section: 'timers',
	control: {
		type: 'switches',
		options: [{ key: 'sound', label: 'Alarm sound', hint: 'Beep when done.' }]
	}
});
```

| Control    | Shape                              | Shows                                |
| ---------- | ---------------------------------- | ------------------------------------ |
| `choice`   | `options: [{ value, label }]`      | A segmented control (radio buttons). |
| `switch`   | (none)                             | A switch for a boolean field.        |
| `number`   | `min`, `max`, `step?`, `unit?`     | A − / + stepper.                     |
| `switches` | `options: [{ key, label, hint? }]` | One switch per boolean in an object. |

`hint` adds a line under the field's label. Sections are ordered as in `sections`, then
Appearance, General and Timers, then the rest in the order their fields were added.
Fields in the `privacy` section show in the built-in Privacy card, above the servers the app
contacts (`@xcwds/plugin-lock` puts its cover switch there).

## For plugins

- **`app.settingsPage.control(name, Component)`** shows a field with your component (it gets the
  field's `name`). `@xcwds/plugin-shell` shows its `nav` setting with `NavPicker` this way.
- **`app.settingsPage.add(Component, { props?, order? })`** adds a whole section. Fields sit at
  order 0, Your data at 100, Privacy at 150 and About at 200; `@xcwds/plugin-install` adds its card at -100.

Both are usually called on boot, with the component imported dynamically (the component imports
`@xcwds/sveltekit`, which imports your page entry).

## Your data

- **Backups:** the JSON from `app.storage.exportData()`, downloaded (or shared, where the
  browser can share files). Importing shows what it holds first, then merges or replaces.
- **Clearing:** one button per storage group, named by `groups` or else after its entries
  (e.g. "Clear Home shortcuts"), the ones `groups` lists first, and Clear all data, each
  confirmed first. Clears and imports reach every component on this tab through
  `app.storage.onChange`, so what's showing updates without a reload.
- **A warning** shows when the browser won't let the app save.
- **Toasts** (`app.toast`) confirm what happened; an invalid backup shows an inline error.
