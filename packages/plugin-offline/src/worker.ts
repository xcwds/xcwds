/**
 * The service-worker entry. The integration's runtime already precaches the build and serves
 * it from this version's cache first (`@xcwds/sveltekit/worker`); this plugin tunes that one
 * strategy through `app.worker.policy` instead of adding a second one: runtime caching, extra
 * precached paths, exclusions and the offline fallback page. Other plugins' `onFetch` and
 * `onInstall` hooks still run before it.
 */
import { definePlugin, XcwdsError, codes } from '@xcwds/core';
import type {} from '@xcwds/sveltekit/worker';
import { CORE, NAME, resolveOptions, type OfflineOptions } from './options.js';

export default definePlugin(
	(app, input: OfflineOptions) => {
		const options = resolveOptions(input);
		const worker = app.worker;
		if (!worker)
			throw new XcwdsError(
				codes.PLUGIN_FAILED,
				`${NAME}/worker runs in the service worker that @xcwds/sveltekit/worker starts.`,
				{ plugin: NAME }
			);
		const { policy } = worker;
		policy.precache.push(...options.precache);
		policy.exclude.push(...options.exclude);
		policy.fallback = options.fallback;
		policy.runtimeCaching = options.runtimeCaching;
	},
	{ name: NAME, core: CORE, network: false }
);
