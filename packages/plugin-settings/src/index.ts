/**
 * `@xcwds/plugin-settings`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import settings from '@xcwds/plugin-settings';
 * export default defineConfig({ brand, plugins: [shell({ sections }), settings({ source: 'https://github.com/me/app' })] });
 * ```
 *
 * The build entry adds the settings page to the route registry.
 */
import { definePlugin, descriptor } from '@xcwds/core';
import type {} from '@xcwds/sveltekit/routes';
import { CORE, NAME, resolveOptions, type SettingsOptions } from './options.js';

export type { ResolvedSettingsOptions, SettingsOptions } from './options.js';
export type { AppSettingsPage } from './client.js';
export { backupFileName } from './options.js';

export default descriptor<SettingsOptions>(NAME);

export const build = definePlugin(
	(app, input: SettingsOptions) => {
		const options = resolveOptions(input);
		app.route({
			path: options.path,
			title: options.title,
			...(options.emoji ? { emoji: options.emoji } : {}),
			width: options.width
		});
	},
	{ name: NAME, core: CORE, network: false }
);
