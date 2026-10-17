/**
 * `@xcwds/plugin-blocks`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import blocks from '@xcwds/plugin-blocks';
 * export default defineConfig({ brand, plugins: [tools(), blocks({ app: 'yours' })] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, fail, resolveOptions, type BlocksPluginOptions } from './options.js';

export type { BlocksPluginOptions } from './options.js';

export default descriptor<BlocksPluginOptions>(NAME);

/** What the build checks of `app.tools` (from `@xcwds/plugin-tools`, registered before this). */
type ToolsLike = { apps(): readonly { id: string }[] };

/** Checks the options when the config loads, so a mistake fails the build, not the page. */
export const build = definePlugin(
	(app, input: BlocksPluginOptions) => {
		const options = resolveOptions(input);
		if (options.app === undefined) return;
		const tools = (app as { tools?: ToolsLike }).tools;
		if (!tools) fail('`app` needs `@xcwds/plugin-tools`, registered before this plugin.');
		if (!tools.apps().some((a) => a.id === options.app))
			fail(`\`app\` is "${options.app}", which isn't in \`@xcwds/plugin-tools\`' \`apps\`.`);
	},
	{ name: NAME, core: CORE, network: false }
);
