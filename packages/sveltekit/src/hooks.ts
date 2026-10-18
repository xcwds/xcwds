/**
 * `@xcwds/sveltekit/hooks`, for `src/hooks.server.ts` and `src/hooks.client.ts`:
 *
 *   export { handle, init } from '@xcwds/sveltekit/hooks';
 *
 * `handle` puts the pre-paint script and head tags where app.html has `%xcwds.head%` (RFC 0001,
 * decision 4). It runs while SvelteKit prerenders, including the `404.html` fallback.
 */
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import type { App } from '@xcwds/core';
import { data } from 'virtual:xcwds/client';
import { headScript, injectHead, allowScript, scriptHash } from './head.js';
import { getApp, loadApp } from './runtime.svelte.js';

type Head = { html: string; hash: string | null };
/** Per app, so a new one after HMR gets a fresh head. */
const heads = new WeakMap<App, Promise<Head>>();

/** The head for every page: tags, then one script with plugins' snippets and settings' fields. */
function pageHead(): Promise<Head> {
	const app = getApp();
	let head = heads.get(app);
	if (!head) {
		head = loadApp().then(async () => {
			const script = headScript([...data.head, app.settings.prePaintScript()]);
			const html = [data.tags, script && `<script>${script}</script>`].filter(Boolean).join('\n');
			return { html, hash: script ? await scriptHash(script) : null };
		});
		heads.set(app, head);
	}
	return head;
}

/**
 * Loads the plugins before the app starts, so pages render (and hydrate) with their decorators,
 * routes and settings fields in place. Export it from `hooks.server.ts` and `hooks.client.ts`.
 */
export const init: ServerInit = async () => {
	await loadApp();
};

export const handle: Handle = async ({ event, resolve }) => {
	const { html, hash } = await pageHead();
	const response = await resolve(event, {
		transformPageChunk: ({ html: chunk }) => injectHead(chunk, html, hash)
	});
	// Pages rendered on request (`vite dev`) carry the CSP as a header rather than a <meta>.
	const policy = response.headers.get('content-security-policy');
	if (hash && policy) {
		try {
			response.headers.set('content-security-policy', allowScript(policy, hash));
		} catch {
			// Immutable headers: the response isn't a page.
		}
	}
	return response;
};
