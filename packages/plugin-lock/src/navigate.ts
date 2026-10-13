/**
 * SvelteKit navigation for the page entry, which can't import `$app/*` itself (it also runs in
 * Node, at prerender and in unit tests). Imported lazily, in the browser only.
 */
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

/**
 * An app path as a link. App paths have no params; the cast is because a package can't see the
 * app's route types.
 */
export const href = resolve as unknown as (path: string) => string;

/** Goes to `target`: an app path (without the base path), maybe with a query and a hash. */
export function go(target: string, replaceState = false): Promise<void> {
	const at = target.search(/[?#]/);
	const path = at < 0 ? target : target.slice(0, at);
	const rest = at < 0 ? '' : target.slice(at);
	// eslint-disable-next-line svelte/no-navigation-without-resolve
	return goto(href(path) + rest, { replaceState });
}
