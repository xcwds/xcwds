/**
 * `@xcwds/plugin-share`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import share from '@xcwds/plugin-share';
 * export default defineConfig({
 * 	brand,
 * 	plugins: [shell({ sections }), share({ target: '/utils/url-sanitizer' })]
 * });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { FIELDS, CORE, NAME, resolveOptions, type ShareOptions } from './options.js';

export type { ResolvedShareOptions, ShareOptions, Shared } from './options.js';
export { fromFragment, fromQuery, toFragment } from './options.js';

export default descriptor<ShareOptions>(NAME);

/** Checks the options and, with a `target`, makes the app a share target (GET, so no server). */
export const build = definePlugin(
	(app, input: ShareOptions) => {
		const { target } = resolveOptions(input);
		if (!target) return;
		app.addHook('onManifest', (manifest) => {
			// The manifest's scope is the base path plus "/".
			const scope = typeof manifest.scope === 'string' ? manifest.scope : '/';
			return {
				...manifest,
				share_target: {
					action: scope.replace(/\/$/, '') + target,
					method: 'GET',
					enctype: 'application/x-www-form-urlencoded',
					params: Object.fromEntries(FIELDS.map((f) => [f, f]))
				}
			};
		});
	},
	{ name: NAME, core: CORE, network: false }
);
