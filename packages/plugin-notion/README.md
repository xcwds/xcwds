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

- **The plugin** (`.` and `./client`): `notion({ relay, page })` in `xcwds.config.ts`. `relay`
  is your relay's `https:` origin, and the build declares it as the plugin's only network use
  ([#103](https://github.com/xcwds/xcwds/issues/103)), so the page's content security policy allows exactly that origin. Pages get
  `app.notion`:
  - `connect(token)` checks the token with Notion and saves it only if Notion accepts it.
    `disconnect()` removes the token and every copy.
  - `sources()` / `saveSources(change)` list and edit the sources; removing a source removes its
    copy.
  - `copy(id)`, `status(id)` (downloading, or why the last try failed, with a message safe to
    show) and `refresh(id, { force })`.

  Saved data: the token (`app:notion:token`, its own "Notion connection" group, personal, never
  in backups), the sources (in backups) and the copies (personal, out of backups). When the app
  comes back to the foreground, copies older than the `notionRefreshMinutes` setting (30 by
  default; 0 means only by hand) are downloaded again. Going to the background cancels downloads
  in flight, and app updates wait while one runs. The token is saved unencrypted in browser
  storage until [#79](https://github.com/xcwds/xcwds/issues/79), so use a read-only integration
  shared with only the pages you need.

Still to come: the docs and an example app with e2e tests (the rest of
[#106](https://github.com/xcwds/xcwds/issues/106)), and the pages that show sources and copies
([#107](https://github.com/xcwds/xcwds/issues/107)).
