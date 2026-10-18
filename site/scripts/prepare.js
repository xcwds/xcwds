// `pnpm install`'s prepare step: `svelte-kit sync` writes `$app/tsconfig`, which the site's
// tsconfig extends (Vitest needs it). On a fresh clone the packages aren't built yet, so loading the
// Vite config (which imports `@xcwds/sveltekit/dist`) fails after the tsconfig is written. Its
// stack traces look broken to a new contributor, so they're kept quiet until `pnpm build`.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const built = existsSync(new URL('../../packages/sveltekit/dist/vite.js', import.meta.url));
try {
	execSync('svelte-kit sync', { stdio: built ? 'inherit' : 'ignore' });
} catch {
	// Never fail the install over it; `pnpm check` syncs again.
}
if (!built)
	console.log('site: `svelte-kit sync` finishes once `pnpm build` has built the packages.');
