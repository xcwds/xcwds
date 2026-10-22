# @xcwds/plugin-notion

Notion pages saved on the device in @xcwds apps, read offline. **Work in progress**
([#102](https://github.com/xcwds/xcwds/issues/102)): not published yet, and not a plugin you can
install yet.

So far it holds:

- [The relay](relay/README.md): a stateless, read-only Cloudflare Worker that lets a static app
  reach the Notion API, which sends no CORS headers. It holds no token and stores nothing; the
  person's own token passes through it.
- **`./api`**: `createNotionClient({ relay, token, signal })`, the API client through the relay.
  It pins `Notion-Version: 2025-09-03`, keeps requests 350 ms apart (Notion allows about 3 a
  second), waits out `429` (`Retry-After`, then backoff, up to 3 times) and stops when `signal`
  aborts. `blocks(id)` fetches a page's content with its nested blocks, at most 5 levels and
  2,000 blocks, and says `truncated` when it stopped short. Failures are `NotionError`s with a
  `kind` (`offline`, `unauthorized`, `not-shared`, `rate-limited`, `aborted`, `failed`) and a
  message that's safe to show: never the token, never Notion's own text. `parseId(link)` finds the
  id in a Notion link.
- **`./document`**: `toDocument(page, blocks, { fetchedAt, truncated })` turns a downloaded page
  into the plugin's own versioned JSON (`v: 1`): title, emoji icon, link, created time, properties
  and blocks, with rich text kept as runs of text and their formatting. Rendering will read only
  this shape. Blocks it doesn't know become `{ type: 'unsupported', notionType }`; images and
  files are placeholders until [#108](https://github.com/xcwds/xcwds/issues/108).

- **`./sources`**: what to download. A source is one page, the newest page of a database (by
  created time or a date property, optionally only pages whose title contains some text: the daily
  agenda a scheduled task adds each morning), or the newest child page under a parent page.
  `download(client, source)` finds the page it points at now and returns it in the saved format,
  or `undefined` when there's none yet. `dataSources(client, database)` lists a database's data
  sources to choose from. `fromToday(createdTime)` says whether a page is from today, so
  yesterday's agenda isn't taken for today's. `fitCopy` enforces the size caps (1 MB a copy, 2 MB
  for all of them), and `parseSources` and `parseCopies` check the saved entries.

Saving the token, sources and copies, connecting and refreshing (the rest of
[#106](https://github.com/xcwds/xcwds/issues/106)) and showing them
([#107](https://github.com/xcwds/xcwds/issues/107)) come next.
