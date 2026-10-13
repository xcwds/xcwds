// The page entry. Imported while SvelteKit prerenders too, so nothing here touches `window` or
// `document` until a hook runs in the browser.
import { definePlugin } from '@xcwds/core';

export default definePlugin(
	(app, /** @type {import('./index.js').HelloOptions} */ options) => {
		const greeting = options.greeting ?? 'hello';
		app.settings.field('greeting', {
			default: greeting,
			parse: (v) => (typeof v === 'string' && v.length <= 40 ? v : undefined),
			label: 'Greeting',
			// Applies the saved greeting before first paint.
			prePaint: "if(typeof v==='string')root.dataset.greeting=v;"
		});
		app.decorate('hello', {
			count: app.storage.entry('count', {
				label: 'Hello count',
				parse: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined)
			}),
			// The example's private Journal: a passcode lock's reset clears it (`sensitive`).
			journal: app.storage.entry('journal', {
				label: 'Journal',
				parse: (v) => (typeof v === 'string' ? v : undefined),
				group: 'journal',
				sensitive: true
			})
		});
		// A cache that can be fetched again, so backups leave it out (`backup: false`).
		app.storage.entry('cache', {
			label: 'Hello cache',
			parse: (v) => (typeof v === 'string' ? v : undefined),
			backup: false
		});
		app.addHook('onBoot', () => {
			document.documentElement.dataset.hello = greeting;
		});
		// Test-only: records the order hooks run in for the e2e tests (and @xcwds/testing's, which must
		// match). A real plugin has no reason to do this.
		const record = (/** @type {string} */ entry) => {
			const g = /** @type {{ xcwdsHooks?: string[] }} */ (globalThis);
			(g.xcwdsHooks ??= []).push(entry);
		};
		app.addHook('onNavigate', (to, from) => void record(`guard ${to.path} ${from?.path ?? '-'}`));
		app.addHook('afterNavigate', (to) => void record(`after ${to.path}`));
		// Navigation guards for the e2e tests: redirects, a cancel, a loop and async ones.
		const later = (/** @type {string | undefined} */ value, ms = 50) =>
			new Promise((resolve) => setTimeout(() => resolve(value), ms));
		let visitedOnce = false;
		app.addHook('onNavigate', (to) => {
			if (to.path === '/moved') return '/hello';
			if (to.path === '/blocked') return false;
			if (to.path === '/loop') return '/loop';
			if (to.path === '/slow') return later('/hello');
			if (to.path !== '/hello') return undefined;
			const query = to.url?.searchParams;
			if (query?.has('wait')) return later(undefined);
			if (query?.has('now')) return Promise.resolve(undefined);
			if (query?.has('bounce')) return later('/moved', 1500);
			// Allowed the first time; after that (e.g. Forward) sent home.
			if (query?.has('once')) {
				const answer = visitedOnce ? '/' : undefined;
				visitedOnce = true;
				return later(answer);
			}
			return undefined;
		});
		// Paths reach hooks without the base path.
		app.addHook('afterNavigate', (to) => {
			document.documentElement.dataset.path = to.path;
		});
	},
	{ name: '@xcwds-example/plugin-hello', encapsulate: false }
);
