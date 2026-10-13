import { useApp } from '@xcwds/sveltekit';
import { untrack } from 'svelte';

/** What this plugin uses of `app.lock` (from `@xcwds/plugin-lock`, if present). */
type LockLike = {
	subscribe(listener: () => void): () => void;
	hides(path: string | undefined): boolean;
};

/**
 * Whether a timer started on `path` must hide its label: `@xcwds/plugin-lock` has the app locked
 * and keeps that page out. Reactive: it's checked again when the lock locks or unlocks. Call
 * during component initialisation.
 */
export function useHides(): (path: string | undefined) => boolean {
	const lock = (useApp() as { lock?: LockLike }).lock;
	let version = $state(0);
	// Untracked: the first call runs inside the effect, which mustn't depend on what it writes.
	$effect(() => lock?.subscribe(() => untrack(() => void version++)));
	return (path) => {
		void version;
		return lock?.hides(path) ?? false;
	};
}
