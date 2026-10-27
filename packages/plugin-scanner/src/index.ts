/**
 * `@xcwds/plugin-scanner`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import scanner from '@xcwds/plugin-scanner';
 * export default defineConfig({ brand, plugins: [camera(), scanner()] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type ScannerPluginOptions } from './options.js';

export type { ScannerPluginOptions } from './options.js';

export default descriptor<ScannerPluginOptions>(NAME);

/** Checks the options when the config loads, so a mistake fails the build, not the page. */
export const build = definePlugin(
	(_app, options: ScannerPluginOptions) => void resolveOptions(options),
	{ name: NAME, core: CORE, network: false }
);
