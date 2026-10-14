/**
 * `buildTestApp()`: the page's app without a browser, like Fastify's `inject()` for a server.
 * Plugins load and boot as in `<App>`, with the same setup, routes and guard rules
 * (`@xcwds/sveltekit/routes`), on in-memory storage shared by simulated tabs and an optional
 * fake clock.
 */
import {
	memoryBlobs,
	type App,
	type BlobBackend,
	type LogLevel,
	type Route,
	type StorageAdapter
} from '@xcwds/core';
import { askGuards, decide, routeOf, setupApp } from '@xcwds/sveltekit/routes';
import { fakeClock, type FakeClock } from './clock.js';
import { closeAfterTest, ErrorTrap } from './errors.js';
import { prepare, type Importer, type Prepared, type TestInput } from './plugins.js';
import { isSharedStorage, sharedStorage, type SharedStorage } from './tabs.js';

export type TestAppOptions = {
	/** The storage behind every tab: a plain adapter (e.g. `memoryStorage()`) or `sharedStorage()`. */
	storage?: StorageAdapter | SharedStorage;
	/**
	 * A start time for a fake clock, installed until the app closes, or a clock to share
	 * (`now: other.clock`). Omit for real time.
	 */
	now?: FakeClock | number | Date;
	/** SvelteKit's `paths.base`, for the URLs hooks see. Paths you pass never include it. */
	base?: string;
	/** The page the app opens on. Defaults to `/`. */
	path?: string;
	/** Imports plugin entries for descriptors; see `Importer`. */
	import?: Importer;
	/**
	 * Errors reported to `onError` make the next operation (boot, `navigate`, `settle`, `close`)
	 * reject. `false` only logs them, and collects them in `errors`. Defaults to `true`.
	 */
	strict?: boolean;
	logLevel?: LogLevel;
};

export type NavigationResult = {
	/** Where the app ended up (the previous path when cancelled). */
	path: string;
	/** Each redirect the guards made, in order. */
	redirects: string[];
	cancelled: boolean;
};

export type TestHelpers = {
	/**
	 * Navigates like a link click to an app path (starting with `/`, without the base):
	 * `onNavigate` guards, redirects, then `afterNavigate`.
	 */
	navigate(path: string): Promise<NavigationResult>;
	/** The current path (as navigated to, with any query), without the base path. */
	readonly path: string;
	readonly clock: FakeClock | undefined;
	/** The storage all tabs share. */
	readonly sharedStorage: SharedStorage;
	/** Every error reported to `onError` in any tab, in order. */
	readonly errors: readonly unknown[];
	/** Opens another tab of the same app on the same storage (and clock). */
	openTab(options?: { path?: string }): Promise<TestApp>;
	/** Waits until other tabs' `storage` events have arrived. */
	settle(): Promise<void>;
	/** Closes this tab (and, for the first one, every tab it opened, then restores the clock). */
	close(): Promise<void>;
};

export type TestApp = App & TestHelpers;

const ORIGIN = 'http://localhost';

type Group = {
	prepared: Prepared;
	shared: SharedStorage;
	/** The blobs every tab sees (`app.blobs`), in memory. */
	blobs: BlobBackend;
	clock: FakeClock | undefined;
	base: string;
	logLevel: LogLevel;
	trap: ErrorTrap;
	tabs: Set<TestApp>;
	/** Set once the first tab has closed (taking the others and the clock with it). */
	closed: boolean;
};

async function openTab(group: Group, initial: string): Promise<TestApp> {
	if (group.closed) throw new Error('This test app was closed; build a new one.');
	const { prepared, base, trap } = group;
	const tab = new EventTarget();
	const adapter = group.shared.connect(tab);
	const app = setupApp({
		name: prepared.name,
		storagePrefix: prepared.storagePrefix,
		appName: prepared.appName,
		routes: prepared.routes,
		plugins: prepared.plugins,
		storage: adapter,
		blobs: group.blobs,
		logLevel: group.logLevel
	});
	trap.watch(app);

	const urlOf = (path: string) => {
		if (!path.startsWith('/'))
			throw new TypeError(`"${path}" is not an app path (start it with "/").`);
		return new URL(base + path, ORIGIN);
	};
	// Every URL here is under the base path.
	const route = (url: URL) => routeOf(url, base)!;
	let current = route(urlOf(initial));
	const show = (to: Route) => to.path + (to.url?.search ?? '');

	/**
	 * One navigation, through each redirect its guards make, as the shell does it. `redirects`
	 * counts the hops already made; `afterFirstHop` runs once the first hop's guards answered.
	 */
	async function go(
		target: URL,
		redirects: string[],
		afterFirstHop?: () => Promise<void>
	): Promise<NavigationResult> {
		for (;;) {
			const to = route(target);
			const answer = await askGuards(app, to, current);
			await afterFirstHop?.();
			afterFirstHop = undefined;
			const decision = decide(answer, { target, base, redirects: redirects.length });
			if (decision.action === 'cancel') return { path: show(current), redirects, cancelled: true };
			if (decision.action === 'stop') {
				await app.reportError(decision.error);
				return { path: show(current), redirects, cancelled: true };
			}
			if (decision.action === 'allow') break;
			redirects.push(show(route(decision.url)));
			target = decision.url;
		}
		current = route(target);
		await app.hooks.run('afterNavigate', [current], { path: current.path });
		return { path: show(current), redirects, cancelled: false };
	}

	/**
	 * The first page was loaded, not navigated to: its guards run once the app is ready, and
	 * `false` can't take it back. As in `<App>`, a redirect's own guards answer before the first
	 * page's `afterNavigate`, and the redirected page's `afterNavigate` comes last.
	 */
	async function enter() {
		const first = current;
		const answer = await askGuards(app, first, null);
		const shown = () => app.hooks.run('afterNavigate', [first], { path: first.path });
		const decision = decide(answer, { target: first.url, base, redirects: 0, first: true });
		if (decision.action !== 'redirect') return shown();
		await go(decision.url, [show(route(decision.url))], shown);
	}

	const close = app.close.bind(app);
	let closed = false;
	const helpers: TestHelpers = {
		navigate: (path) => trap.run(() => go(urlOf(path), [])),
		get path() {
			return show(current);
		},
		clock: group.clock,
		sharedStorage: group.shared,
		errors: trap.errors,
		openTab: (options = {}) => openTab(group, options.path ?? '/'),
		settle: () => trap.run(() => group.shared.settled()),
		async close() {
			if (closed) return;
			closed = true;
			const first = [...group.tabs][0] === testApp;
			if (first) group.closed = true;
			group.tabs.delete(testApp);
			try {
				await close();
				adapter.disconnect();
				if (first) for (const other of [...group.tabs]) await other.close().catch(() => {});
			} finally {
				if (first) group.clock?.uninstall();
			}
			trap.check();
		}
	};
	const testApp = app as TestApp;
	group.tabs.add(testApp);
	// Until the helpers are in place, closing is the kernel's (plus the tab bookkeeping).
	Object.defineProperty(app, 'close', { value: helpers.close, configurable: true });

	try {
		await app.load();
		// Own properties of the root view, beside the plugins' decorators.
		for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(helpers))) {
			if (key !== 'close' && key in app)
				throw new Error(`A plugin's decorator "${key}" clashes with an @xcwds/testing helper.`);
			Object.defineProperty(app, key, { ...descriptor, configurable: true });
		}
		app.storage.startSync(tab);
		await app.hooks.run('onBoot', []);
		await app.ready();
		await enter();
		trap.check();
	} catch (error) {
		await testApp.close().catch(() => {});
		throw error;
	}
	return testApp;
}

/**
 * Boots an app for a unit test. `input` is a whole config or `{ plugins }`, where a plugin is a
 * function, a `[plugin, options]` pair or a descriptor (loaded from its package's `./client`,
 * with its build entry's routes). Inside a test it closes when the test finishes; close it
 * yourself otherwise.
 */
export async function buildTestApp(
	input: TestInput,
	options: TestAppOptions = {}
): Promise<TestApp> {
	const logLevel = options.logLevel ?? 'warn';
	const prepared = await prepare(input, 'client', { importer: options.import, logLevel });
	const clock =
		options.now === undefined
			? undefined
			: typeof options.now === 'object' && 'install' in options.now
				? options.now
				: fakeClock(options.now);
	const group: Group = {
		prepared,
		shared: isSharedStorage(options.storage) ? options.storage : sharedStorage(options.storage),
		blobs: memoryBlobs(),
		clock,
		base: options.base ?? '',
		logLevel,
		trap: new ErrorTrap(options.strict ?? true),
		tabs: new Set(),
		closed: false
	};
	// Each app installs its clock once and uninstalls it once, when its first tab closes.
	clock?.install();
	let app: TestApp;
	try {
		app = await openTab(group, options.path ?? '/');
	} catch (error) {
		if (group.tabs.size === 0 && !group.closed) clock?.uninstall();
		throw error;
	}
	closeAfterTest(() => app.close());
	return app;
}
