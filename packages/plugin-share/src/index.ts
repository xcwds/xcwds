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
import { FIELDS, FILES_FIELD, CORE, NAME, resolveOptions, type ShareOptions } from './options.js';

export type {
	ResolvedShareOptions,
	ShareFilesOptions,
	ShareOptions,
	Shared,
	SharedFiles
} from './options.js';
export { filesFromFragment, fromFragment, fromQuery, toFragment } from './options.js';

export default descriptor<ShareOptions>(NAME);

/**
 * Checks the options and, with a `target`, makes the app a share target: GET, so no server. With
 * `files`, POST to `files.target`, which the worker answers (a manifest has one `share_target`, so
 * links take the same route).
 */
export const build = definePlugin(
	(app, input: ShareOptions) => {
		const { target, files } = resolveOptions(input);
		if (!target && !files) return;
		const params = Object.fromEntries(FIELDS.map((f) => [f, f]));
		app.addHook('onManifest', (manifest) => {
			// The manifest's scope is the base path plus "/".
			const base = (typeof manifest.scope === 'string' ? manifest.scope : '/').replace(/\/$/, '');
			const share_target = files
				? {
						action: base + files.target,
						method: 'POST',
						enctype: 'multipart/form-data',
						params: { ...params, files: [{ name: FILES_FIELD, accept: files.accept }] }
					}
				: {
						action: base + target,
						method: 'GET',
						enctype: 'application/x-www-form-urlencoded',
						params
					};
			return { ...manifest, share_target };
		});
	},
	{ name: NAME, core: CORE, network: false }
);
