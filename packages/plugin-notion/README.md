# @xcwds/plugin-notion

Notion pages saved on the device in @xcwds apps, read offline. **Work in progress**
([#102](https://github.com/xcwds/xcwds/issues/102)): not published yet, and not a plugin you can
install yet.

So far it holds [the relay](relay/README.md): a stateless, read-only Cloudflare Worker that lets a
static app reach the Notion API, which sends no CORS headers. It holds no token and stores
nothing; the person's own token passes through it. Connecting, choosing pages, downloading them
([#106](https://github.com/xcwds/xcwds/issues/106)) and showing them
([#107](https://github.com/xcwds/xcwds/issues/107)) come next.
