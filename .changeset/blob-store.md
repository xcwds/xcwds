---
'@xcwds/core': minor
---

Blob store: `app.blobs` keeps files and images in IndexedDB. Plugins register collections like storage entries (`register({ key, label, group, sensitive, validate })`), then `put`, `get`, `list`, `delete`, `clear` and `usage()`; every call is async and never throws. `onChange` hears other tabs, `layer()` wraps the backend, and `persist()` asks the browser to keep the data. `createApp({ blobs })` takes another `BlobBackend`, such as `memoryBlobs()`.
