/**
 * `@xcwds/plugin-blocks`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import blocks from '@xcwds/plugin-blocks';
 * export default defineConfig({ brand, plugins: [tools(), blocks({ app: 'yours' })] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type BlocksPluginOptions } from './options.js';

export type { BlocksPluginOptions } from './options.js';

export default descriptor<BlocksPluginOptions>(NAME);

/** Checks the options when the config loads, so a mistake fails the build, not the page. */
export const build = definePlugin(
	(_app, options: BlocksPluginOptions) => void resolveOptions(options),
	{ name: NAME, core: CORE, network: false }
);
