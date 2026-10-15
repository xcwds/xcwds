---
'@xcwds/plugin-tools': minor
---

Apps people turn on and off (#158): group tools into `apps`, each with its own pages (`routes`) and data (`groups`). The new Apps page (`AppCatalog.svelte`) has a switch per app and Remove data for an app that's off. Tools of apps that are off leave Home and the index page (pins are kept), and their pages show `AppOffNotice.svelte` with a Turn on button. `app.tools` gains `all()`, `apps()`, `appOf()`, `isOn()`, `setOn()`, `subscribe()` and `catalog`, and the `apps` setting holds which apps are on.
