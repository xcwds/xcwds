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

- **`<NotionDocument document={copy} />`** (`./NotionDocument.svelte`): draws one saved copy.
  The icon and title come first, as an `<h2>`, since the shell's header holds the page's `<h1>`.
  Then come the properties as a short list, then the blocks. Notion's headings 1–3 become
  `<h3>`–`<h5>`. It draws paragraphs, nested bulleted and numbered lists, to-dos (read-only
  checkboxes), toggles and toggle headings, quotes, callouts, code, dividers, tables with header
  rows and columns, child pages and links to pages (by title), bookmarks and embeds (as links),
  equations (as their source) and columns (stacked on phones). Bold, italic, strikethrough,
  underline, code and Notion's colours carry over, in light and dark mode. Images and files
  show a placeholder until [#108](https://github.com/xcwds/xcwds/issues/108). Anything else says
  "Not shown here" with an Open in Notion link. Text is always text, never HTML. Links keep only
  `https:`, `http:` and `mailto:` addresses (anything else keeps its text without the link), and
  open in a new tab with `rel="noopener noreferrer"`. Import `@xcwds/plugin-notion/styles.css`
  after Tailwind and `@xcwds/plugin-theme/tailwind.css` so Tailwind sees its classes.
  `./render` holds the helpers it uses (`safeHref`, `colorClass`, `groupBlocks` and the rest).

- **`<NotionView />`** (`./NotionView.svelte`): the page for one source's copy, at
  `<page>/view#<source id>`. The id goes in the fragment, so it never reaches a server. Render it
  from that route's file inside `<main class="page-wide">`. It shows when the copy was downloaded
  and has a Refresh button. Opening it downloads the source again when its copy is older than
  the refresh setting, and the saved copy stays in view offline or when a download fails. A
  "newest" source whose page isn't from today says "No newer page yet", so yesterday's agenda
  isn't taken for today's. The build entry registers `<page>/view` (title "Notion page", private,
  `wide`). `page` itself is the app's to list (as a tool, say), or pass `register: true` and the
  plugin registers it (title "Notion", private, `wide`).

The example app's base-path build runs the plugin at `/utils/notion`, with `/utils/notion/view`
for one copy, and e2e tests against a mocked relay.

Still to come: `<NotionSources>` for the sources page and `xcwds add notion` (the rest of
[#107](https://github.com/xcwds/xcwds/issues/107)).
