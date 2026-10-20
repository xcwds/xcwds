/**
 * `@xcwds/plugin-recorder`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import recorder from '@xcwds/plugin-recorder';
 * export default defineConfig({ brand, plugins: [recorder({ noiseSuppression: false })] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type RecorderPluginOptions } from './options.js';

export type { RecorderPluginOptions } from './options.js';

export default descriptor<RecorderPluginOptions>(NAME);

/** Checks the options when the config loads, so a mistake fails the build, not the page. */
export const build = definePlugin(
	(_app, options: RecorderPluginOptions) => void resolveOptions(options),
	{ name: NAME, core: CORE, network: false }
);
