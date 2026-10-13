// The build entry (RFC 0001, decision 1). Calling the plugin in xcwds.config.ts returns a plain,
// serialisable descriptor; `build` runs in Node while the config loads.
import { definePlugin, descriptor } from '@xcwds/core';

/** @type {(options?: import('./index.js').HelloOptions) => import('@xcwds/core').Descriptor<import('./index.js').HelloOptions>} */
export default descriptor('@xcwds-example/plugin-hello');

/** Build hooks and the plugin's page in the route registry. */
export const build = definePlugin(
	(app, /** @type {import('./index.js').HelloOptions} */ options) => {
		const greeting = options.greeting ?? 'hello';
		// Plain ES5 that runs before first paint (decision 4).
		app.addHook(
			'onHead',
			() => `document.documentElement.dataset.prepaint=${JSON.stringify(greeting)};`
		);
		app.route({ path: '/hello', title: 'Hello', emoji: '👋', parent: '/', width: 'narrow' });
	},
	{
		name: '@xcwds-example/plugin-hello',
		// Worked out from the options (#103): the app picks the origin, so it's fixed at build time.
		network: (/** @type {import('./index.js').HelloOptions} */ options) =>
			options.origin ? { origins: [options.origin], reason: 'Fetches greetings' } : false
	}
);
