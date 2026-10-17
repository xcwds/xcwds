# @xcwds/plugin-blocks

Small apps people add to an @xcwds app (a chore checklist, a water counter, a mood or symptom
log), defined as data rather than code (RFC 0001, decision 14). **Work in progress**
([#160](https://github.com/xcwds/xcwds/issues/160)): not published yet, and not a plugin you can
install yet.

So far it holds the definition format and the logic of each block, from
`@xcwds/plugin-blocks/model`, and the plugin, which saves your apps and their data on the device
(`app.blocks`) and adds each one to `@xcwds/plugin-tools` as a tool. The pages that run apps come
next; building your own apps is #161 and sharing them #162.

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
- **`app`**: the id of an app in `@xcwds/plugin-tools`' `apps` that your apps join as tools.

It declares `network: false`.

### `app.blocks`

```ts
const added = app.blocks.addFromTemplate(app.blocks.templates[0]);
if (!added.ok) showError(added.error);
const data = app.blocks.data(added.app.id); // read against the app's definition
```

- **`list()`**: your apps (`{ id, name, emoji, private, path }`), normal ones first.
  **`get(id)`**: an app's definition. **`pathOf(app)`**: the page that runs it.
- **`save(input)`**: adds an app or replaces the one with its id, after checking it with
  `parseApp`: `{ ok: true, app }`, or `{ ok: false, error }` with a sentence to show next to
  the control (invalid, or storage full or blocked). **`addFromTemplate(t)`** saves a copy
  with a new id.
- **`data(id)`** and **`saveData(id, data)`**: an app's data (false when it couldn't be
  saved).
- **`remove(id)`**: removes an app and its data, and returns `{ ok, restore }`; `restore()`
  puts both back in their place, for an Undo.
- **`onChange(listener)`**: your apps or their data changed, here, in another tab, or by
  clearing or importing data.

Saved data: definitions in `app:blocks:apps` (group `blocks`, backed up) and, for private apps,
`app:blocks:private-apps` (group `blocks-private`, personal, so a lock's reset clears it); each
app's data in `app:blocks:data:<id>` or `app:blocks:private:<id>`. Turning an app private (or
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

## Templates

`templates` holds starters (Water, Chores, Mood); `fromTemplate(t)` copies one with a new id, so
a template never changes apps already added.
