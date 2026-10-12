/**
 * `@xcwds/plugin-install`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import install from '@xcwds/plugin-install';
 * export default defineConfig({ brand, plugins: [install()] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CATCH_PROMPT, CORE, NAME, resolveOptions, type InstallOptions } from './options.js';

export type { InstallOptions } from './options.js';
export { isIos, isStandalone } from './options.js';

export default descriptor<InstallOptions>(NAME);

/** Checks the options, and catches an early install prompt in the head script. */
export const build = definePlugin(
	(app, options: InstallOptions) => {
		resolveOptions(options);
		app.addHook('onHead', () => CATCH_PROMPT);
	},
	{ name: NAME, core: CORE, network: false }
);
