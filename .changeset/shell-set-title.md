---
'@xcwds/plugin-shell': minor
---

`app.shell.setTitle(text)` titles the page showing now, for pages whose title isn't known at build time (part of #160). The header shows it, and `<title>` too unless the route is private; it holds for that path only.
