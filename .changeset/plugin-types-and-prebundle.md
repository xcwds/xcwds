---
'@xcwds/sveltekit': minor
---

Apps no longer keep lists that follow the plugin list: `withXcwds()` writes `.xcwds/types.d.ts` (a type-only import of each plugin's `./client` entry) and adds it to SvelteKit's generated tsconfig, so the `import type {} from '@xcwds/plugin-*/client'` lines in `src/app.d.ts` can go; and `xcwds()` adds installed plugins' page entries to `optimizeDeps.include`, so a hand-kept list in `vite.config.ts` can go too.
