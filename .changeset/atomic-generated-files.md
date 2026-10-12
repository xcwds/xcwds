---
'@xcwds/sveltekit': patch
---

Write the generated `.xcwds/` files atomically, so builds that run at once (Vitest loads the config once per project) never import an empty `build.js` (#110).
