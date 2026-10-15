---
'@xcwds/plugin-shell': minor
'@xcwds/plugin-tools': minor
---

A shell section can belong to an app (`sections[].app`, #159): it's hidden in the tab bar, header links and sidebar while that app is off, from first paint, and comes back when it's turned on in any tab. `@xcwds/plugin-tools` sets `data-apps-off` on `<html>` (before first paint too) and checks that each section's app is one of its `apps`.
