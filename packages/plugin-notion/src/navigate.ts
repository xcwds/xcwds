/**
 * Links to the plugin's pages with the app's base path (the page entry can't import `$app/*`: it
 * also runs in Node, at prerender and in unit tests).
 */
import { resolve } from '$app/paths';

/** The page for one source's copy: `<page>/view#<source id>`, the id in the fragment. */
export function viewHref(page: string, id: string): string {
	return `${(resolve as unknown as (path: string) => string)(`${page}/view`)}#${encodeURIComponent(id)}`;
}
