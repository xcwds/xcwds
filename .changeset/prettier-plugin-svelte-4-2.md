---
'@xcwds/create': patch
'@xcwds/plugin-blocks': patch
'@xcwds/plugin-camera': patch
'@xcwds/plugin-changelog': patch
'@xcwds/plugin-lock': patch
'@xcwds/plugin-notion': patch
'@xcwds/plugin-qr': patch
'@xcwds/plugin-recorder': patch
'@xcwds/plugin-scanner': patch
'@xcwds/plugin-settings': patch
'@xcwds/plugin-shell': patch
'@xcwds/plugin-timers': patch
'@xcwds/plugin-tools': patch
---

Reformat Svelte components for prettier-plugin-svelte 4.2, which puts element content on its own lines. Svelte 5 trims whitespace at the start and end of an element, so nothing renders differently. Apps from `npm create @xcwds` with the scanner get the same layout.
