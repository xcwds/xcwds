/**
 * `@xcwds/plugin-camera`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import camera from '@xcwds/plugin-camera';
 * export default defineConfig({ brand, plugins: [camera({ maxSide: 2048 })] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type CameraPluginOptions } from './options.js';

export type { CameraPluginOptions } from './options.js';

export default descriptor<CameraPluginOptions>(NAME);

/** Checks the options when the config loads, so a mistake fails the build, not the page. */
export const build = definePlugin(
	(_app, options: CameraPluginOptions) => void resolveOptions(options),
	{ name: NAME, core: CORE, network: false }
);
