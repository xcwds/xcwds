# @xcwds/plugin-blocks

Small apps people add to an @xcwds app (a chore checklist, a water counter, a mood or symptom
log), defined as data rather than code (RFC 0001, decision 14). **Work in progress**
([#160](https://github.com/xcwds/xcwds/issues/160)): not published yet, and not a plugin you can
install yet.

So far it holds the definition format and the logic of each block, from
`@xcwds/plugin-blocks/model`, with no UI and no storage. The pages that run apps, adding them from
templates and the Home and catalog integration come next; building your own apps is #161 and
sharing them #162.

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
