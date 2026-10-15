---
'@xcwds/plugin-tools': minor
---

Tools on a shared page (part of #160): a tool's `path` can end with a `#fragment` (`/my-apps/app#k3f9`), which pins and Recently used tell apart. The page entry can `app.tools.add()` such tools at any time and `app.tools.remove(path)` them with their pin, `subscribe` follows both, and their saved pins are kept while the tool isn't there yet.
