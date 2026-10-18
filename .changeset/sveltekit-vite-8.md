---
'@xcwds/sveltekit': patch
---

Works with Vite 8 (the `vite` peer range now includes `^8.0.0`). On Vite 8, `xcwds.config.ts` is compiled with an empty tsconfig (`.xcwds/config.tsconfig.json`), as before, so a fresh checkout loads it before `svelte-kit sync` has written the tsconfig the app's own extends.
