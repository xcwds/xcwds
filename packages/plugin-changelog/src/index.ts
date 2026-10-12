/**
 * `@xcwds/plugin-changelog`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import changelog from '@xcwds/plugin-changelog';
 * import { notes } from './src/lib/changelog.js';
 * export default defineConfig({ brand, plugins: [shell({ sections }), settings(), update(), changelog({ entries: notes })] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type ChangelogOptions } from './options.js';

export type { ChangelogEntry, ChangelogOptions, ResolvedChangelogOptions } from './options.js';
export type { AppChangelog } from './client.js';

export default descriptor<ChangelogOptions>(NAME);

/** Checks the options when the config loads, so a mistake fails the build, not the page. */
export const build = definePlugin(
	(_app, options: ChangelogOptions) => void resolveOptions(options),
	{
		name: NAME,
		core: CORE,
		network: false
	}
);
