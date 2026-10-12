/**
 * `@xcwds/plugin-offline`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import offline from '@xcwds/plugin-offline';
 * export default defineConfig({ brand, plugins: [offline({ exclude: ['/videos/**'] })] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type OfflineOptions } from './options.js';

export type { OfflineOptions, ResolvedOfflineOptions } from './options.js';

export default descriptor<OfflineOptions>(NAME);

/** Checks the options when the config loads, so a mistake fails the build, not the worker. */
export const build = definePlugin((_app, options: OfflineOptions) => void resolveOptions(options), {
	name: NAME,
	core: CORE,
	network: false
});
