# @xcwds/plugin-notion

Notion pages saved on the device in @xcwds apps, read offline. **Work in progress**
([#102](https://github.com/xcwds/xcwds/issues/102)): not published yet, and not a plugin you can
install yet.

So far it holds:

- [The relay](relay/README.md): a stateless Cloudflare Worker that lets a static app reach the
  Notion API, which sends no CORS headers. It holds no token and stores nothing; the person's own
  token passes through it. It's read-only unless its deployer turns on two writes (`ALLOW_WRITES`).
- **`./api`**: `createNotionClient({ relay, token, signal })`, the API client through the relay.
  It pins `Notion-Version: 2025-09-03`, keeps requests 350 ms apart (Notion allows about 3 a
  second), waits out `429` (`Retry-After`, then backoff, up to 3 times) and stops when `signal`
  aborts. `blocks(id)` fetches a page's content with its nested blocks, at most 5 levels and
  2,000 blocks, and says `truncated` when it stopped short. Failures are `NotionError`s with a
  `kind` (`offline`, `unauthorized`, `not-shared`, `rate-limited`, `aborted`, `failed`) and a
  message that's safe to show: never the token, never Notion's own text. `parseId(link)` finds the
  id in a Notion link. `setChecked(id, checked)` and `appendParagraphs(id, paragraphs)` are its
  two writes ([#109](https://github.com/xcwds/xcwds/issues/109)), which need the relay's writes
  on.
- **`./document`**: `toDocument(page, blocks, { fetchedAt, truncated })` turns a downloaded page
  into the plugin's own versioned JSON (`v: 1`): title, emoji icon, link, created time, properties
  and blocks, with rich text kept as runs of text and their formatting. Rendering will read only
  this shape. Blocks it doesn't know become `{ type: 'unsupported', notionType }`; files, PDFs,
  video and audio are placeholders. An image is `{ type: 'image', caption }` with `file` (its id
  among the saved images), `external` (a link to an image on another site) or `skipped` (why it
  isn't on the device). Notion's signed links to images are never kept. A to-do keeps its Notion
  block `id`, so it can be ticked.
- **`./outbox`** ([#109](https://github.com/xcwds/xcwds/issues/109)): changes waiting to be sent to Notion, ticking a to-do and adding a short note at the end
  of a page. `enqueue` adds one (a tick that undoes a waiting one cancels both), `applyOutbox`
  shows the waiting changes on a copy, and `flush(client, update)` sends them in order, each
  step applied to the latest saved outbox so changes made meanwhile aren't lost. A
  tick Notion has the other way, edited there since the copy was downloaded, keeps Notion's and
  comes back as a conflict. No connection, rate limits and Notion's own errors keep the rest queued
  for later; a refusal (`4xx`) stays queued with its reason until `retry`. A note that may have
  reached Notion before the connection dropped is looked for at the end of the page before it's
  sent again. `parseOutbox` checks the saved entry.

- **`./sources`**: what to download. A source is one page, the newest page of a database (by
  created time or a date property, optionally only pages whose title contains some text: the daily
  agenda a scheduled task adds each morning), or the newest child page under a parent page.
  `download(client, source)` finds the page it points at now and returns it in the saved format,
  or `undefined` when there's none yet. `dataSources(client, database)` lists a database's data
  sources to choose from. `fromToday(createdTime)` says whether a page is from today, so
  yesterday's agenda isn't taken for today's. `fitCopy` enforces the size caps (1 MB a copy, 2 MB
  for all of them), and `parseSources` and `parseCopies` check the saved entries. Given an image
  store, `download` also fetches the images Notion hosts (`client.file`, through the relay's
  `/file`, without the token): at most 5 MB an image, and 20 MB or 50 images a source, reusing
  an image already saved for the same file.

- **The plugin** (`.` and `./client`): `notion({ relay, page, writes })` in `xcwds.config.ts`. `relay`
  is your relay's `https:` origin, and the build declares it as the plugin's only network use
  ([#103](https://github.com/xcwds/xcwds/issues/103)), so the page's content security policy allows exactly that origin. Pages get
  `app.notion`:
  - `connect(token)` checks the token with Notion and saves it only if Notion accepts it.
    `disconnect()` removes the token and every copy.
  - `sources()` / `saveSources(change)` list and edit the sources; removing a source removes its
    copy.
  - `copy(id)`, `status(id)` (downloading, or why the last try failed, with a message safe to
    show) and `refresh(id, { force })`.
  - `image(id)`: a saved image a copy shows, as a `Blob`.
  - With `writes: true` ([#109](https://github.com/xcwds/xcwds/issues/109); the relay's
    `ALLOW_WRITES` on, and a token with Notion's "Update content" and "Insert content"
    capabilities): `change(source, { kind: 'check', block, checked })` ticks one of the copy's
    to-dos and `change(source, { kind: 'note', text })` adds a note at its end. The change is saved
    in the outbox and `copy(source)` shows it at once. It's sent right away, when the connection
    comes back, when the app comes back to the foreground and before that source is downloaded
    again, one send at a time across tabs (a Web Lock). The copies it changed are downloaded again
    afterwards. `outbox()` lists what's waiting (a change Notion refused has `failed`, kept until
    `retry(id)` or `discard(id)`), `send()` sends now and says what happened, `sending()` says
    whether a send runs, and `conflicts()` lists the ticks Notion had the other way, edited there
    since, whose Notion value stays (`clearConflicts()` once shown). The pages don't offer these
    yet.

  Saved data: the token (`app:notion:token`, its own "Notion connection" group, personal, never
  in backups), the sources (in backups), the copies (personal, out of backups) and their images
  (the blob collection `app:notion:images`, in the copies' group, personal, out of backups). A
  new copy deletes the images the one before showed and it doesn't, removing a source deletes
  its images, and Disconnect deletes them all. With `writes`, the outbox (`app:notion:outbox`) is
  personal and out of backups too, since a restored change could go to Notion twice, and
  Disconnect clears it. When the app
  comes back to the foreground, copies older than the `notionRefreshMinutes` setting (30 by
  default; 0 means only by hand) are downloaded again. Going to the background cancels downloads
  in flight, and app updates wait while one runs or changes are being sent (a change still
  waiting is saved, so it survives the update). The token is saved unencrypted in browser
  storage until [#79](https://github.com/xcwds/xcwds/issues/79), so use a read-only integration
  shared with only the pages you need.

- **`<NotionDocument document={copy} />`** (`./NotionDocument.svelte`): draws one saved copy.
  The icon and title come first, as an `<h2>`, since the shell's header holds the page's `<h1>`.
  Then come the properties as a short list, then the blocks. Notion's headings 1–3 become
  `<h3>`–`<h5>`. It draws paragraphs, nested bulleted and numbered lists, to-dos (read-only
  checkboxes), toggles and toggle headings, quotes, callouts, code, dividers, tables with header
  rows and columns, child pages and links to pages (by title), bookmarks and embeds (as links),
  equations (as their source) and columns (stacked on phones). Bold, italic, strikethrough,
  underline, code and Notion's colours carry over, in light and dark mode. Saved images show
  from the device, with their caption, when you pass `image`
  (`<NotionDocument document={copy} image={app.notion.image} />`, as `<NotionView>` does). An
  image from another site is a link that's never loaded, and one that wasn't saved says why.
  Files, PDFs, video and audio show a placeholder. Anything else says
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
  `wide`).

- **`<NotionSources />`** (`./NotionSources.svelte`): the sources page, at `page`. Render it
  from that route's file inside `<main class="page-narrow">`. It connects (setup steps, a token
  field and Test connection; Disconnect asks first and removes the token and every copy), lists
  the sources with when each was last downloaded, a Refresh button and Remove (which asks
  first), and adds a source: one page, the newest page in a database (newest by creation or by a
  date property, optionally only titles containing some text) or the newest child page of a
  page, from a Notion link or id. A database with several data sources asks which one to read.
  Each source's label links to its copy at `<page>/view`. `page` is the app's to list (as a
  tool, say), or pass `register: true` and the plugin registers it (title "Notion", private,
  `narrow`).

The example app's base-path build runs the plugin at `/utils/notion` (`<NotionSources>`), with
`/utils/notion/view` for one copy, and e2e tests against a mocked relay.

`xcwds add notion` (from [`@xcwds/create`](../create)) writes both pages, `/notion` with
`<NotionSources>` and `/notion/view` with `<NotionView>`, a Notion tab, the styles and
`notion({ relay: 'https://your-notion-relay.invalid', register: true })`. The build refuses a
relay on `.invalid`, so it fails until you deploy the relay ([`relay/README.md`](relay/README.md))
and put its origin there. It's offered once this package is published.
