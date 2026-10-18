---
'@xcwds/plugin-install': minor
'@xcwds/plugin-settings': minor
---

The Install card is now a card like the settings page's others, and its words can be set once in the config: `install({ text: { heading, intro, install, iosSteps, menu } })` (also `app.install.text`; a card's `text` prop still wins). `settings({ fields: [...] })` orders fields within their section; fields left out follow in the order plugins added them.
