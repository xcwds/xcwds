/**
 * The build entry: the factory you call in xcwds.config.ts, and the `build` plugin that runs in
 * Node while the config loads.
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type TallyOptions } from './options.js';

export type { TallyOptions } from './options.js';
export type { Tally } from './tally.js';

export default descriptor<TallyOptions>(NAME);

export const build = definePlugin(
	(app, options: TallyOptions) => {
		// A mistake in the options fails the build, not the page.
		const { path } = resolveOptions(options);
		app.route({ path, title: 'Tally', emoji: '🔢', parent: '/', width: 'narrow' });
	},
	{ name: NAME, core: CORE, network: false }
);
