/**
 * `@xcwds/plugin-notion`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import notion from '@xcwds/plugin-notion';
 * export default defineConfig({
 * 	brand,
 * 	plugins: [notion({ relay: 'https://notion-relay.example.com' })]
 * });
 * ```
 *
 * The plugin contacts the relay, and only the relay (#103): the build puts its origin in the
 * page's content security policy, and Settings → Privacy names it with the reason.
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, REASON, resolveOptions, type NotionPluginOptions } from './options.js';

export type { NotionPluginOptions } from './options.js';

export default descriptor<NotionPluginOptions>(NAME);

/** Checks the options when the config loads, so a mistake fails the build, not the page. */
export const build = definePlugin(
	(_app, options: NotionPluginOptions) => void resolveOptions(options),
	{
		name: NAME,
		core: CORE,
		network: (options) => ({
			origins: [resolveOptions(options).relay],
			reason: REASON
		})
	}
);
