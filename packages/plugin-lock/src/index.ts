/**
 * `@xcwds/plugin-lock`: the config factory and build entry (RFC 0001, decision 1). Protections
 * for the app's private pages (`private: true` in the route registry): a cover in the app
 * switcher and no spellcheck or autocomplete in their fields (#75), and a passcode lock with an
 * unlock screen (#76).
 *
 * ```ts
 * import lock from '@xcwds/plugin-lock';
 * export default defineConfig({ brand, plugins: [lock()] });
 * ```
 */
import { definePlugin, descriptor, resolveConfig } from '@xcwds/core';
import type {} from '@xcwds/sveltekit/routes';
import { CORE, NAME, concealScript, resolveOptions, type LockOptions } from './options.js';

export type { AutoLockMinutes, LockOptions, LockScope, LockSetting } from './options.js';
export { isPrivate, needsUnlock } from './options.js';

export default descriptor<LockOptions>(NAME);

/**
 * Checks the options, adds the unlock screen to the route registry (not private, so it never
 * needs unlocking), and hides the page before first paint while a passcode is set, until the app
 * has booted and knows whether the page is locked.
 */
export const build = definePlugin(
	(app, input: LockOptions) => {
		const options = resolveOptions(input);
		app.route({ path: options.unlock, title: 'Locked', width: 'narrow' });
		let prefix = 'app:';
		app.addHook('onConfig', (config) => {
			prefix = resolveConfig(config).storage.prefix;
		});
		app.addHook('onHead', () => concealScript(prefix));
	},
	{ name: NAME, core: CORE, network: false }
);
