/**
 * The service-worker entry: a share opens the target page with what was shared in its query
 * (`?url=…&text=…&title=…`). Before that request leaves the device, the worker answers it with
 * a 303 to the same page with the fields in the fragment, which browsers never send to a
 * server, so shared content never reaches one or its logs.
 */
import { definePlugin } from '@xcwds/core';
import type {} from '@xcwds/sveltekit/worker';
import { CORE, NAME, fromQuery, resolveOptions, toFragment, type ShareOptions } from './options.js';

export default definePlugin(
	(app, input: ShareOptions) => {
		const { target } = resolveOptions(input);
		if (!target) return;
		app.addHook('onFetch', (request, url) => {
			if (request.mode !== 'navigate' || !url.search) return;
			const base = app.worker?.base ?? '';
			if ((url.pathname.replace(/\/$/, '') || '/') !== base + target) return;
			const shared = fromQuery(url.searchParams);
			if (!shared) return;
			return Response.redirect(`${url.origin}${base}${target}${toFragment(shared)}`, 303);
		});
	},
	{ name: NAME, core: CORE, network: false }
);
