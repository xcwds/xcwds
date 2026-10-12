/**
 * `@xcwds/plugin-lock`: the config factory and build entry (RFC 0001, decision 1). Protections
 * for the app's private pages (`private: true` in the route registry): a cover in the app
 * switcher and no spellcheck or autocomplete in their fields (#75). The passcode lock (#76)
 * builds on it.
 *
 * ```ts
 * import lock from '@xcwds/plugin-lock';
 * export default defineConfig({ brand, plugins: [lock()] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type LockOptions } from './options.js';

export type { LockOptions, LockSetting } from './options.js';
export { isPrivate } from './options.js';

export default descriptor<LockOptions>(NAME);

/** Checks the options. */
export const build = definePlugin(
	(_app, options: LockOptions) => {
		resolveOptions(options);
	},
	{ name: NAME, core: CORE, network: false }
);
