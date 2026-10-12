/**
 * `@xcwds/plugin-theme`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import theme from '@xcwds/plugin-theme';
 * export default defineConfig({ brand, plugins: [theme()] });
 * ```
 */
import { definePlugin, descriptor, resolveConfig, type ThemeColor } from '@xcwds/core';
import { COLORS_GLOBAL, CORE, NAME, resolveOptions, type ThemeOptions } from './options.js';

export type { ResolvedThemeOptions, Theme, ThemeOptions } from './options.js';

export default descriptor<ThemeOptions>(NAME);

/**
 * Checks the options, and hands `brand.themeColor` to the page: the head script sets it as a
 * global before the `theme` field's pre-paint snippet runs, so the browser bar matches too.
 */
export const build = definePlugin(
	(app, options: ThemeOptions) => {
		resolveOptions(options);
		let colors: Required<ThemeColor> | undefined;
		app.addHook('onConfig', (config) => {
			// Earlier `onConfig` hooks have run; the config's file checks don't matter here.
			colors = resolveConfig(config).brand.themeColor;
		});
		app.addHook('onHead', () => {
			if (!colors) return;
			// JSON is valid ES5; `<` is escaped so a colour can't close the script.
			const json = JSON.stringify(colors).replace(/</g, '\\u003c');
			return `window.${COLORS_GLOBAL}=${json};`;
		});
	},
	{ name: NAME, core: CORE, network: false }
);
