/**
 * `@xcwds/plugin-blocks`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import blocks from '@xcwds/plugin-blocks';
 * export default defineConfig({ brand, plugins: [tools(), blocks({ app: 'yours' })] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import type {} from '@xcwds/sveltekit/routes';
import { CORE, NAME, fail, resolveOptions, type BlocksPluginOptions } from './options.js';

export type { BlocksPluginOptions } from './options.js';

export default descriptor<BlocksPluginOptions>(NAME);

/** What the build uses of `app.tools` (from `@xcwds/plugin-tools`, registered before this). */
type ToolsLike = { index: string; apps(): readonly { id: string }[] };

/**
 * Checks the options when the config loads, so a mistake fails the build, not the page, and adds
 * the pages to the route registry: Your apps at `path`, and the pages that run an app at
 * `<path>/app` and `<path>/private` (private, so it's locked, covered and never shared).
 */
export const build = definePlugin(
	(app, input: BlocksPluginOptions) => {
		const options = resolveOptions(input);
		const tools = (app as { tools?: ToolsLike }).tools;
		const { path } = options;
		app.route({
			path,
			title: 'Your apps',
			emoji: '🧩',
			width: 'wide',
			...(tools ? { parent: tools.index } : {})
		});
		// Titled by the app that's open (`app.shell.setTitle`); these are the fallbacks.
		app.route({ path: `${path}/app`, title: 'App', parent: path, width: 'narrow' });
		app.route({
			path: `${path}/private`,
			title: 'Private app',
			parent: path,
			width: 'narrow',
			private: true
		});
		if (options.app === undefined) return;
		if (!tools) fail('`app` needs `@xcwds/plugin-tools`, registered before this plugin.');
		if (!tools.apps().some((a) => a.id === options.app))
			fail(`\`app\` is "${options.app}", which isn't in \`@xcwds/plugin-tools\`' \`apps\`.`);
	},
	{ name: NAME, core: CORE, network: false }
);
