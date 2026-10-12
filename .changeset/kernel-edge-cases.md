---
'@xcwds/core': patch
'@xcwds/sveltekit': patch
---

Kernel and integration edge cases (#58):

- `satisfies()` compares prerelease tags identifier by identifier (`beta.2` < `beta.10`) and supports hyphen ranges (`1.2.3 - 2.0.0`); a plugin whose `core` range can't be read fails with a clear "unsupported range" error instead of a version mismatch.
- `hasDecorator()` no longer counts `Object.prototype` names (`toString`, `isPrototypeOf`…) as decorators.
- Other tabs' storage listeners no longer see the `probe` key `storage.writable()` writes.
- `app.load()` documents that a failed load keeps rejecting, so the app must be recreated.
- An `onNavigate` guard answer that isn't an app path (`//host/…`, `https://…`) stops the navigation and goes to `onError` instead of leaving the app.
