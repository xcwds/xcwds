# The Notion relay

The Notion API sends no CORS headers, so a static app can't call it from the browser.
[`worker.ts`](worker.ts) is the smallest thing that can: a Cloudflare Worker that adds CORS headers
for your app's origins and forwards a short list of read requests to `https://api.notion.com`
([#105](https://github.com/xcwds/xcwds/issues/105)). It ships in the package so you deploy the
version your app installs, and it's never part of an app's bundle.

## What it does, and doesn't

- **Holds no token.** The app sends the person's own Notion integration token in
  `Authorization`, and the relay passes it on unchanged. It can't read anyone's workspace without
  their token.
- **Stores nothing.** No KV, D1, cache or logs, and every answer says `Cache-Control: no-store`.
  The example config turns Workers Logs off; leave it off.
- **Read-only.** It forwards these and refuses everything else with `403` before a request
  leaves:

  | Request                                         | For                               |
  | ----------------------------------------------- | --------------------------------- |
  | `GET /v1/users/me`                              | Checking the token                |
  | `GET /v1/pages/:id`                             | A page's title and properties     |
  | `GET /v1/blocks/:id`, `/v1/blocks/:id/children` | A page's content                  |
  | `GET /v1/databases/:id`                         | Finding a database's data sources |
  | `GET /v1/data_sources/:id`                      | A data source's properties        |
  | `POST /v1/data_sources/:id/query`               | The newest page in a database     |
  | `POST /v1/search`                               | Choosing pages                    |

  Ids must be Notion ids (UUIDs, dashed or not). The only query parameters are `start_cursor` and
  `page_size` (1 to 100), each once.

- **Only your app's origins.** Requests from an origin not in `ALLOWED_ORIGINS` (or with none)
  are refused, with no CORS headers. That stops other websites using your relay from a browser.
  It isn't authentication: the token is.
- **Forwards little.** Only `Authorization`, `Notion-Version` (a date) and `Content-Type` (always
  `application/json`), and request bodies of at most 64 KB (`413` beyond). Cookies and client
  address headers stay behind. From Notion's answer, only its status, body, `Content-Type` and
  `Retry-After` (on `429`) come back.

## Deploy

You need a Cloudflare account and a domain on it.

1. Install the plugin in your app (`pnpm add @xcwds/plugin-notion`).
2. Copy [`wrangler.toml.example`](wrangler.toml.example) to `wrangler.toml` in your app's folder.
   Set `routes` to the relay's address (for example `notion-relay.example.com`) and
   `ALLOWED_ORIGINS` to your app's origin (for example `https://example.com`; add
   `http://localhost:5173` only on a separate development relay).
3. Run `npx wrangler login`, then `npx wrangler deploy`.
4. In the Cloudflare dashboard, check under the Worker's **Settings → Observability** that Workers
   Logs and Logpush are off.
5. Give the plugin the relay's origin, so the app's content security policy allows it and
   Settings → Privacy names it.

After updating the plugin, deploy again so the relay matches.

## Check it

```sh
curl -i https://notion-relay.example.com/v1/users/me \
  -H 'Origin: https://example.com' \
  -H 'Authorization: Bearer <your token>' \
  -H 'Notion-Version: 2025-09-03'
```

That returns your integration's bot user. The same request with another `Origin`, or to a path
not in the table, returns `403`.

## Not included

OAuth sign-in (a public Notion integration needs a server holding its client secret), writes
(planned in [#109](https://github.com/xcwds/xcwds/issues/109), behind a separate allowlist you
turn on) and per-person rate limits beyond Cloudflare's own.
