// `pnpm install`'s prepare step: `svelte-kit sync` writes `.svelte-kit/` for editors and
// `svelte-check`. On a fresh clone the packages aren't built yet, and loading the Vite config
// (which imports `@xcwds/sveltekit/dist`) would fail with stack traces, so it waits for `pnpm build`.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync(new URL('../../packages/sveltekit/dist/vite.js', import.meta.url))) {
	try {
		execSync('svelte-kit sync', { stdio: 'inherit' });
	} catch {
		// Never fail the install over it; `pnpm check` syncs again.
	}
} else {
	console.log('site: skipping `svelte-kit sync` until `pnpm build` has built the packages.');
}
