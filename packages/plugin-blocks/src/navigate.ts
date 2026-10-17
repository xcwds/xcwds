/**
 * SvelteKit navigation for the components (the page entry can't import `$app/*`: it also runs
 * in Node, at prerender and in unit tests).
 */
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

/** An app path, maybe with a `#hash`, as a link with the base path. */
export function href(target: string): string {
	const at = target.indexOf('#');
	const path = at < 0 ? target : target.slice(0, at);
	return (resolve as unknown as (path: string) => string)(path) + (at < 0 ? '' : target.slice(at));
}

/** Goes to `target`, an app path maybe with a `#hash`. */
export function go(target: string, replaceState = false): Promise<void> {
	// eslint-disable-next-line svelte/no-navigation-without-resolve
	return goto(href(target), { replaceState });
}
