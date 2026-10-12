/**
 * `@xcwds/plugin-update`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import update from '@xcwds/plugin-update';
 * export default defineConfig({ brand, plugins: [offline(), update({ askBeforeReload: true })] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type UpdateOptions } from './options.js';

export type { ResolvedUpdateOptions, UpdateOptions } from './options.js';

export default descriptor<UpdateOptions>(NAME);

/** Checks the options when the config loads, so a mistake fails the build, not the page. */
export const build = definePlugin((_app, options: UpdateOptions) => void resolveOptions(options), {
	name: NAME,
	core: CORE,
	network: false
});
