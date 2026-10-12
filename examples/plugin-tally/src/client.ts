/**
 * The page entry. It runs in the browser, and in Node while SvelteKit prerenders, so it doesn't
 * touch `window` or `document` here (only in hooks such as `onBoot`).
 */
import { definePlugin, type Entry } from '@xcwds/core';
import { CORE, NAME, isStep, resolveOptions, type TallyOptions } from './options.js';
import { parseTally, type Tally } from './tally.js';

/** `app.tally`. */
export type AppTally = {
	/** The saved tally, for `persist()` or `app.storage.read()`. */
	readonly entry: Entry<Tally>;
};

declare module '@xcwds/core' {
	interface App {
		/** From xcwds-plugin-tally. */
		readonly tally?: AppTally;
	}
	interface Settings {
		/** From xcwds-plugin-tally: how much one tap adds. */
		tallyStep: number;
	}
}

export default definePlugin(
	(app, options: TallyOptions) => {
		const { step } = resolveOptions(options);

		app.settings.field('tallyStep', {
			default: step,
			parse: (v) => (isStep(v) ? v : undefined),
			label: 'Tally step',
			hint: 'How much one tap adds.',
			section: 'tally',
			control: { type: 'number', min: 1, max: 100 }
		});

		// Saved as `app:tally:tally`.
		const entry = app.storage.entry('tally', { label: 'Tally', parse: parseTally });

		// Version 0 of this plugin saved a bare number. Version 1 saves `{ count, since }`.
		app.storage.migration({
			to: 1,
			run(data) {
				const old = data[entry.key];
				if (typeof old === 'number')
					data[entry.key] = { count: old, since: new Date().toISOString() };
			}
		});

		app.decorate('tally', { entry } satisfies AppTally);
	},
	// Without `encapsulate: false`, `app.tally` would stay inside this plugin.
	{ name: NAME, core: CORE, encapsulate: false }
);
