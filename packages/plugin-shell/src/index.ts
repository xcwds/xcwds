/**
 * `@xcwds/plugin-shell`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import shell from '@xcwds/plugin-shell';
 * export default defineConfig({
 * 	brand,
 * 	plugins: [shell({ sections: [{ path: '/', label: 'Home', emoji: '🏠' }] })]
 * });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type ShellOptions } from './options.js';

export type { NavSetting, NavStyle, Section, ShellOptions } from './options.js';
export { activeSection, pageInfo, type PageInfo } from './nav.js';

export default descriptor<ShellOptions>(NAME);

/** Checks the options when the config loads, so a mistake fails the build, not the page. */
export const build = definePlugin((_app, options: ShellOptions) => void resolveOptions(options), {
	name: NAME,
	core: CORE,
	network: false
});
