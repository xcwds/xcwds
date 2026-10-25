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
import type {} from '@xcwds/sveltekit/routes';
import { CORE, NAME, reason, resolveOptions, type NotionPluginOptions } from './options.js';

export type { NotionPluginOptions } from './options.js';

export default descriptor<NotionPluginOptions>(NAME);

/**
 * Checks the options when the config loads, so a mistake fails the build, not the page, and adds
 * the page that shows one copy, `<page>/view` (the source's id in the fragment), to the route
 * registry. With `register`, `page` itself too. Both are private: never in Recently used, a
 * shortcut or a Share button, since they show what's in someone's Notion.
 */
export const build = definePlugin(
	(app, input: NotionPluginOptions) => {
		const { page, register } = resolveOptions(input);
		if (register)
			app.route({ path: page, title: 'Notion', emoji: '🗒️', width: 'narrow', private: true });
		app.route({
			path: `${page}/view`,
			title: 'Notion page',
			parent: page,
			width: 'wide',
			private: true
		});
	},
	{
		name: NAME,
		core: CORE,
		network: (options) => {
			const resolved = resolveOptions(options);
			return { origins: [resolved.relay], reason: reason(resolved) };
		}
	}
);
