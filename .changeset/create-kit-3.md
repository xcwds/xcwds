---
'@xcwds/create': minor
---

New apps start on SvelteKit 3, Vite 8, `@sveltejs/vite-plugin-svelte` 7 and TypeScript 6: no `svelte.config.js` (`xcwds()` in `vite.config.ts` takes SvelteKit's config), a tsconfig that extends `$app/tsconfig`, and `#lib/...` imports for `src/lib` in place of `$lib`.
