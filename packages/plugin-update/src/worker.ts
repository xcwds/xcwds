/**
 * The service-worker entry: a waiting version takes over only when a page asks for it with
 * `{ type: 'SKIP_WAITING' }` (the user tapped Update). The integration's runtime never calls
 * `skipWaiting()` on install.
 */
import { definePlugin } from '@xcwds/core';
import type {} from '@xcwds/sveltekit/worker';
import { CORE, NAME, SKIP_WAITING, resolveOptions, type UpdateOptions } from './options.js';

export default definePlugin(
	(app, options: UpdateOptions) => {
		resolveOptions(options);
		app.addHook('onMessage', async (data) => {
			if ((data as { type?: unknown } | null)?.type === SKIP_WAITING)
				await app.worker?.skipWaiting();
		});
	},
	{ name: NAME, core: CORE, network: false }
);
