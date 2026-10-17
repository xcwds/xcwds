# @xcwds/plugin-blocks

Small apps people add to an @xcwds app (a chore checklist, a water counter, a mood or symptom
log), defined as data rather than code (RFC 0001, decision 14).

It holds the definition format and the logic of each block, from `@xcwds/plugin-blocks/model`;
the plugin, which saves your apps and their data on the device (`app.blocks`) and adds each one to
`@xcwds/plugin-tools` as a tool; and the pages: Your apps, with New app, Add from a file and Add
from a template, the page that runs an app, the builder that makes or edits one, and the page
that adds an app someone shared. `pnpm xcwds add blocks` adds it to an app.

## The plugin

```ts
// xcwds.config.ts
import blocks from '@xcwds/plugin-blocks';
export default defineConfig({
	brand,
	plugins: [
		tools({ path: '/utils', apps: [{ id: 'yours', name: 'Your apps', emoji: '🧩', blurb: '…' }] }),
		blocks({ app: 'yours' })
	]
});
```

Options (all JSON):

- **`path`** (default `/my-apps`): where Your apps lives. An app runs at `<path>/app#<id>`, or
  `<path>/private#<id>` when it's private; the id is in the fragment, so it never reaches a
  server.
- **`templates`**: what "Add from a template" offers (default: the built-in `templates`, below).
  Each is checked with `parseApp` when the config loads.
- **`app`**: the id of an app in `@xcwds/plugin-tools`' `apps` that your apps join as tools. The build
  fails when it isn't one of them (register this plugin after `tools()`).

It declares `network: false`. Its build entry adds five pages to the route registry: Your apps at
`path` (under the tools index, with plugin-tools), `<path>/app` and `<path>/private` that run an
app, and the builder at `<path>/edit` and `<path>/private-edit`. The private ones are private
routes, so `@xcwds/plugin-lock` locks them, its cover applies and Share skips them.

### The pages

Add each page's route file, and the components' styles after Tailwind and the shell's:

```svelte
<!-- src/routes/my-apps/+page.svelte -->
<script lang="ts">
	import YourApps from '@xcwds/plugin-blocks/YourApps.svelte';
</script>

<main class="page-wide"><YourApps /></main>

<!-- src/routes/my-apps/app/+page.svelte, and the same with <BlocksApp private /> in
     src/routes/my-apps/private/+page.svelte -->
<script lang="ts">
	import BlocksApp from '@xcwds/plugin-blocks/BlocksApp.svelte';
</script>

<main class="page-narrow"><BlocksApp /></main>

<!-- src/routes/my-apps/edit/+page.svelte, and the same with <AppBuilder private /> in
     src/routes/my-apps/private-edit/+page.svelte -->
<script lang="ts">
	import AppBuilder from '@xcwds/plugin-blocks/AppBuilder.svelte';
</script>

<main class="page-narrow"><AppBuilder /></main>

<!-- src/routes/my-apps/import/+page.svelte -->
<script lang="ts">
	import ImportApp from '@xcwds/plugin-blocks/ImportApp.svelte';
</script>

<main class="page-narrow"><ImportApp /></main>
```

```css
/* app.css */
@import '@xcwds/plugin-blocks/styles.css';
```

- **`<YourApps>`**: New app and Add from a file; your apps, each with its size, Share design and
  Delete (it asks with the app's name, then offers Undo); how much they take up together, with a warning near the browser's
  limit; and Add from a template, which saves a copy and opens it.
- **`<BlocksApp>`**: runs the app whose id is in the fragment. The header shows its name
  (`app.shell.setTitle`; a private page's `<title>` stays "Private app"). An app opened on the
  wrong one of the two pages goes to the right one, and an id that isn't on this device says so
  with a link back. A checklist ticks items off (a repeating one says when it's back), a counter
  has − and + with its goal and past days or weeks, a log adds entries from its fields, charts each number or scale field over 7, 30 or
  90 days (an inline SVG with a text summary, and Show as table), and lists the entries newest
  first (Edit fills the form and keeps the entry's time; Delete offers Undo), and notes save as you type. Each change saves from
  what's stored now, so another tab's change isn't lost; while `app.lock` is locked a private
  app shows nothing. Edit app opens the builder on it.
- **`<AppBuilder>`**: with no fragment, a new app; with `#<id>`, that app (a private one on the
  private page, which redirects like `<BlocksApp>`). Name, emoji (common ones to tap, or type
  one), Private, and the blocks: add any of the four, set each up (a checklist's items and
  repeats, a counter's goal, unit and reset, a log's fields with their type and options), Move
  up / Move down for blocks, items and fields, and Remove with Undo for blocks and fields. The
  limits show as you go ("3 of 12 fields"). Save checks the app with `parseApp` and shows the
  problem next to Save; if the change drops saved data, it lists what (`dataLoss`) and asks
  first, then saves (removing that data), says Saved (`app.toast`) and opens the app. Changes
  are kept as you make them (`saveDraft`), so leaving and coming back, or a reload, brings them
  back until Save or Discard changes; one draft at a time. A private draft only comes back where the
  lock covers it: on the normal page while unlocked, or on the private page (a new private app's
  draft goes there). Preview shows the app as it will
  look, working on data that's thrown away ("Preview, nothing saved"). An app that's saved also
  has Share design, which shares it as last saved.
- **Share design** (`<ShareDesign design={app} />`, also on its own): a dialog with Share link
  (the system share sheet, where there is one), Copy link and Save as file
  (`<name>.xcwds-app.json`). It shares how the app is built, never what's saved in it, and asks
  first for a private app. A design whose link would be over 8 KB (`MAX_LINK`) is offered as a
  file only.
- **`<ImportApp>`**: opens a shared link (`<path>/import#app=<data>`) or, without one, lets you
  choose a file. It takes the design out of the address bar and history as soon as it's read,
  says it came from someone else, and lists the name, emoji and every block, item and field as
  text. Add app saves a copy with a new id (so it never replaces one of yours) and opens it;
  Cancel goes back to Your apps. A link or file that isn't a design this version can open says
  only that.

With `@xcwds/plugin-share`, add `path` to its `exclude`: a link to `<path>/app` or `<path>/edit`
opens nothing on another device, and `<path>/import` isn't worth sharing without its fragment.

### `app.blocks`

```ts
const added = app.blocks.addFromTemplate(app.blocks.templates[0]);
if (!added.ok) showError(added.error);
const data = app.blocks.data(added.app.id); // read against the app's definition
```

- **`list()`**: your apps (`{ id, name, emoji, private, path }`), normal ones first.
  **`get(id)`**: an app's definition. **`pathOf(app)`**: the page that runs it.
  **`editPathOf(app?)`**: the builder's page for it, or for a new app.
- **`save(input)`**: adds an app or replaces the one with its id, after checking it with
  `parseApp`: `{ ok: true, app }`, or `{ ok: false, error }` with a sentence to show next to
  the control (invalid, or storage full or blocked). Replacing an app removes the data its new
  definition can't keep (see [Editing an app](#editing-an-app)); if the save fails, the data
  stays as it was. **`addFromTemplate(t)`** saves a copy with a new id.
- **`data(id)`** and **`saveData(id, data)`**: an app's data (false when it couldn't be
  saved).
- **`remove(id)`**: removes an app and its data, and returns `{ ok, restore }`; `restore()`
  puts both back in their place, for an Undo.
- **`usage()`**: about how much your apps take up, `{ total, apps, nearLimit }`, counted as
  storage counts it (characters of keys and values); `nearLimit` is past `NEAR_LIMIT`, 80% of
  the 5 million characters most browsers give a site.
- **`draft()`** and **`saveDraft(draft)`**: the builder's unsaved changes, `{ for, app }` (`for`
  is the app's id, or `''` for a new app); `undefined` clears them. A private app's draft (or one
  being made private) is kept in the private group; drafts are never backed up.
- **`onChange(listener)`**: your apps or their data changed, here, in another tab, or by
  clearing or importing data.

Saved data: definitions in `app:blocks:apps` (group `blocks`, backed up) and, for private apps,
`app:blocks:private-apps` (group `blocks-private`, personal, so a lock's reset clears it); each
app's data in `app:blocks:data:<id>` or `app:blocks:private:<id>`; the builder's draft in
`app:blocks:draft` or `app:blocks:private-draft` (not backed up). Turning an app private (or
back) writes its definition and data to the new keys first and removes the old ones after, so a
failed write leaves it where it was. Every failed write is reported through the app's
save-failure toast.

### Your apps on Home

With `@xcwds/plugin-tools`, each app is a tool (its name and emoji, 🧩 when it has none; in the
`app` option's catalog app), so it can be pinned on Home and shows in Recently used; private
ones are private tools, never under Recently used. The tools follow your apps, here or in another
tab: a new name or emoji keeps the pin (with plugin-tools' `update`). Turning an app private
changes its page, so its pin goes, and so does a removed app's, even after Undo.

## The definition format (1)

```json
{
	"format": 1,
	"id": "k3f9a0Zq",
	"name": "Water",
	"emoji": "💧",
	"private": false,
	"blocks": [
		{ "id": "b1", "type": "counter", "label": "Glasses", "goal": 8, "reset": "daily" },
		{
			"id": "b2",
			"type": "log",
			"label": "Notes",
			"fields": [{ "id": "f1", "type": "text", "label": "Note" }]
		}
	]
}
```

`parseApp(json)` is the only way a definition gets in. It returns `{ ok: true, value }` with a clean
copy holding only the fields it knows, or `{ ok: false, error }` with the first problem as a
sentence. An unknown `format` or block type is rejected, never half-rendered. All text is
text: names and labels are never rendered as HTML, Markdown or links.

Block types:

- **checklist**: `items`, each `{ id, label, repeat? }`. Without `repeat` an item stays ticked
  until unticked. `{ "repeat": "daily" }`, `{ "repeat": "weekly", "weekdays": [1, 4] }` (0 is
  Sunday) or `{ "repeat": "every", "days": 3 }` untick it on the day it's due again.
- **counter**: `reset` (`never`, `daily` or `weekly`, weeks starting on Monday), optional
  `goal` and `unit`. Counts don't go below zero; past days or weeks are kept as history.
- **log**: `fields`, each `{ id, type, label }`: `number` (`unit`, `min`, `max`), `scale`
  (`max` 5 or 10, words for the `low` and `high` ends), `yesno`, `choice` (`options`, each
  `{ id, label }`), `text` (up to 500 characters) and `time` (`HH:MM`). Entries are kept newest
  first; `number` and `scale` fields get a chart over 7, 30 or 90 days with a text summary.
- **notes**: one plain-text area.

Limits (`LIMITS`): 32 KB of JSON, 20 blocks, 12 fields per log, 200 checklist items, 12
options per choice, names up to 60 characters and labels up to 80. A notes block holds up to
20,000 characters (`LIMITS.notes`; longer saved notes are cut on load). Ids are 1-32 letters, digits,
`-` or `_`; `newId()` makes random ones.

"Today" is the local calendar day from the wall clock (`dayKey`), and day arithmetic runs on
those days, so resets and repeats happen at local midnight whatever DST does.

## Data

An app's data is `{ format: 1, blocks: { [blockId]: data } }`. `parseData(app, raw)` reads it
back against the app's current definition and drops anything it can no longer show: removed
blocks, items or fields, and values the fields no longer allow.

- Checklist: `isTicked`, `tick`, `nextDue`, `progress`.
- Counter: `current` (rolls over to the new day or week), `adjust`, `periodOf`.
- Log: `parseValues` (checks a new or edited entry), `addEntry`, `updateEntry`, `removeEntry`
  (returns the removed entry for Undo), `series`, `summarize`, `summaryText`.

## Editing an app

Fields, items and options are matched by id, so renaming one keeps its data. What an edit drops
(#161), from `@xcwds/plugin-blocks/model`:

- **`dataLoss(before, after, data)`**: what saving `after` would remove, to ask first: a block
  with data that's removed or becomes another type (`kind: 'block'`), a log field removed
  (`'field'`), a field whose type changes (`'type'`, even when the old values would fit the new
  type), values that no longer fit a field's options or limits (`'values'`), and a counter's
  running total when it starts resetting daily or weekly (`'count'`), each with its number of
  entries or values. Ticks of removed checklist items go without asking.
  **`lossText(loss)`** says one as a sentence.
- **`pruneData(before, after, data)`**: the data `after` keeps; `app.blocks.save` writes it, so
  dropped data is removed, not hidden.
- **`blankApp()`**, **`blankBlock(type)`**, **`blankField(type)`**: starting points for the
  builder, with new ids. **`move(list, index, by)`**: Move up (`-1`) and Move down (`1`).
- **`parseDraft(raw)`**: reads a saved draft back, allowing what a builder holds mid-edit (an
  empty name or label) but only shapes it can show; `parseApp` still checks it at Save.

## Sharing a design

A shared design is the definition without its `id` (#162), from `@xcwds/plugin-blocks/model`:

- **`encodeDesign(app)`**: the link's `<data>`: the JSON compressed with
  `CompressionStream('deflate-raw')` and base64url-encoded, or, without `CompressionStream`,
  uncompressed after a `u.` prefix. **`designFragment(data)`** makes `#app=<data>` and
  **`dataOf(hash)`** reads it back. It lives in the fragment, which browsers never send to a
  server.
- **`decodeDesign(data)`**: the design, checked by `parseApp`, with a new id; anything that isn't
  one (corrupt, another format, over the limits, or inflating past them) gives `NOT_AN_APP`.
- **`designFile(app)`** (`{ name, text }`) and **`readDesignFile(text)`**: the same as a file.

## Templates

`templates` holds starters (Water, Chores, Mood); `fromTemplate(t)` copies one with a new id, so
a template never changes apps already added.
