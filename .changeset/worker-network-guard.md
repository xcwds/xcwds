---
'@xcwds/sveltekit': patch
'@xcwds/testing': patch
---

The service worker can no longer contact origins the app doesn't declare. The page's CSP doesn't reach the worker, so the generated worker now installs a guard (`@xcwds/sveltekit/guard`) before any plugin's worker code runs: `fetch`, `WebSocket`, `EventSource`, `WebTransport`, `Cache#add`/`addAll` and background fetches refuse any origin other than the app's own, the ones plugins declare and `privacy.allowOrigins`, with an error naming it (#55). `buildTestWorker` applies the same rule, with an `allowOrigins` option.
