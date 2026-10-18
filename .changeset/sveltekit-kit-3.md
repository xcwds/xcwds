---
'@xcwds/sveltekit': minor
---

Moves to SvelteKit 3, Vite 8 and adapter-static 4, and drops SvelteKit 2 (#57). SvelteKit 3 has no `svelte.config.js`, so `@xcwds/sveltekit/config` and `withXcwds()` are gone: pass SvelteKit's config to `xcwds()` instead, which now also adds SvelteKit's Vite plugin (`plugins: [xcwds({ paths: { base } }, { adapter })]`, without `sveltekit()`). The app's tsconfig extends `$app/tsconfig` and lists `.xcwds/types.d.ts` in its `include`. The service worker reads SvelteKit's `$app/manifest`, and a guard's redirect to a path SvelteKit has no route for loads that page (SvelteKit 3's `goto` refuses it) once its own guards allow it. The README has the migration steps.
