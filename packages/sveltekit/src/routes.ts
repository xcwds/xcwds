/**
 * The route registry (#10): what the shell needs to know about each page (title, emoji, back
 * target, width), replacing xcwds.github.io's hand-written `routeInfo` in `src/lib/nav.ts`.
 * Plugins add their pages with `app.route()` from their build entry, so the paths are known when
 * `svelte.config.js` loads and can be fed to prerender `entries`; the page bundle gets the same
 * list. Paths never include the base path (RFC 0001, decision 9).
 *
 * Also the framework-free core the page, the service worker and @xcwds/testing share, so they
 * can't drift apart: how an app is set up, which route a URL is, what guards' answers mean, and
 * which requests the worker handles.
 */
import {
	XcwdsError,
	codes,
	createApp,
	type App,
	type LogLevel,
	type Plugin,
	type Route,
	type StorageAdapter
} from '@xcwds/core';

/** The page container: `page-narrow`, `page-wide`, or `page-split` (narrow until two columns fit). */
export type RouteWidth = 'narrow' | 'wide' | 'split';

export type RouteDefinition = {
	/** The page's path, relative to the adding plugin's `prefix` (`/` is the prefix itself). */
	path: string;
	title: string;
	emoji?: string;
	/** Where the header's back arrow goes (an app path). Top-level pages have none. */
	parent?: string;
	/** Which page container the page uses, so the shell's header lines up with it. */
	width?: RouteWidth;
	/** A personal page: plugins keep it out of what they share or list (e.g. the Share button). */
	private?: boolean;
};

export type RouteInfo = Omit<RouteDefinition, 'path'> & {
	/** The full app path, without the base path. */
	path: string;
	/** The plugin that added it (`''` for the app). */
	plugin: string;
};

export type RouteRegistry = {
	/** The route for a path (without the base path), ignoring a trailing slash. */
	get(path: string): RouteInfo | undefined;
	list(): RouteInfo[];
};

declare module '@xcwds/core' {
	interface App {
		/** Adds a page to the route registry, under this plugin's `prefix`. */
		route(route: RouteDefinition): App;
		readonly routes: RouteRegistry;
	}
}

/** `/a/b/` → `/a/b`, `''` → `/`. */
export function normalizePath(path: string): string {
	const p = `/${path}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
	return p || '/';
}

/** `pathname` without `base` (`/sub/hello` → `/hello`), or null when it isn't under `base`. */
export function stripBase(pathname: string, base: string): string | null {
	if (!base) return pathname;
	if (pathname === base) return '/';
	return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : null;
}

const WIDTHS: readonly string[] = ['narrow', 'wide', 'split'];

function check(route: RouteDefinition, plugin: string): void {
	const fail = (message: string) => {
		throw new XcwdsError(codes.CONFIG_INVALID, `Route from "${plugin || 'the app'}": ${message}`, {
			plugin: plugin || undefined
		});
	};
	if (typeof route !== 'object' || route === null) fail('must be an object');
	if (typeof route.path !== 'string' || !route.path.startsWith('/'))
		fail(`path must start with "/" (got ${JSON.stringify(route.path)})`);
	if (/[?#]/.test(route.path)) fail(`path "${route.path}" can't have a query or hash`);
	if (typeof route.title !== 'string' || route.title.trim() === '')
		fail(`"${route.path}" needs a title`);
	if (route.emoji !== undefined && typeof route.emoji !== 'string')
		fail(`the emoji of "${route.path}" must be a string`);
	if (
		route.parent !== undefined &&
		(typeof route.parent !== 'string' || !route.parent.startsWith('/'))
	)
		fail(`the parent of "${route.path}" must be a path starting with "/"`);
	if (route.width !== undefined && !WIDTHS.includes(route.width))
		fail(`the width of "${route.path}" must be "narrow", "wide" or "split"`);
	if (route.private !== undefined && typeof route.private !== 'boolean')
		fail(`private of "${route.path}" must be true or false`);
}

/** A registry holding `initial` (routes the build collected), with a function that adds more. */
export function createRoutes(initial: readonly RouteInfo[] = []): RouteRegistry & {
	add(route: RouteDefinition, plugin?: string, prefix?: string): RouteInfo;
} {
	const routes = new Map<string, RouteInfo>();
	function add(route: RouteDefinition, plugin = '', prefix = ''): RouteInfo {
		check(route, plugin);
		const path = normalizePath(`${prefix}/${route.path}`);
		const existing = routes.get(path);
		if (existing)
			throw new XcwdsError(
				codes.CONFIG_INVALID,
				`The route "${path}" from "${plugin || 'the app'}" is already added by "${existing.plugin || 'the app'}".`,
				{ plugin: plugin || undefined }
			);
		const info: RouteInfo = { ...route, path, plugin };
		if (info.parent !== undefined) info.parent = normalizePath(info.parent);
		routes.set(path, info);
		return info;
	}
	for (const r of initial) {
		const { plugin, ...route } = r;
		add(route, plugin);
	}
	return {
		add,
		get: (path) => routes.get(normalizePath(path)),
		list: () => [...routes.values()]
	};
}

/**
 * Gives an app `route()` and `routes`. `route()` is called as a method, so `this` is the calling
 * plugin's view of the app, whose name and prefix it records.
 */
export function decorateRoutes(app: App, initial: readonly RouteInfo[] = []): RouteRegistry {
	const registry = createRoutes(initial);
	app.decorate('route', function (this: App, route: RouteDefinition) {
		registry.add(route, this.pluginName, this.prefix);
		return this;
	});
	app.decorate('routes', { get: registry.get, list: registry.list });
	return app.routes;
}

export type AppSetup = {
	/** `brand.name`. */
	name: string;
	storagePrefix: string | undefined;
	/** The app's name in backups. Defaults to `name`. */
	appName?: string;
	routes: readonly RouteInfo[];
	/** Each plugin's entry with its options from the config. */
	plugins: readonly (readonly [Plugin<never>, Record<string, unknown>])[];
	/** Defaults to `localStorage` (in a browser). */
	storage?: StorageAdapter;
	logLevel?: LogLevel;
};

/** Creates the app a page or a service worker runs: routes decorated, every plugin registered. */
export function setupApp(setup: AppSetup): App {
	const app = createApp({
		storage: setup.storage,
		storagePrefix: setup.storagePrefix,
		appName: setup.appName ?? setup.name,
		logLevel: setup.logLevel
	});
	decorateRoutes(app, setup.routes);
	for (const [plugin, options] of setup.plugins) app.register(plugin, { ...options } as never);
	return app;
}

/** The route hooks see for a URL: its path without the base path (as written), or null outside the app. */
export function routeOf(url: URL, base: string): (Route & { url: URL }) | null {
	const path = stripBase(url.pathname, base);
	return path === null ? null : { path, url };
}

/** Redirects one navigation may go through before it is stopped (a loop between guards). */
export const MAX_REDIRECTS = 5;

/** Runs the `onNavigate` guards for a hop: synchronously when every hook answers synchronously. */
export function askGuards(app: App, to: Route, from: Route | null): unknown {
	return app.hooks.firstNow('onNavigate', [to, from], { path: to.path });
}

/** What happens after the guards answered for one hop. */
export type GuardDecision =
	| { action: 'allow' }
	| { action: 'cancel' }
	/** `redirects` counts the hops made, this one included. */
	| { action: 'redirect'; url: URL; redirects: number }
	/**
	 * Too many redirects in a row, or an answer that isn't an app path: the navigation stops and
	 * `error` goes to `onError`.
	 */
	| { action: 'stop'; error: Error };

/**
 * Turns the guards' answer for a navigation to `target` into what happens next: `false`
 * cancels (except on the first page, which was loaded rather than navigated to and is already
 * showing), a path (without the base, starting with one `/`) redirects, anything else allows it. `redirects` counts
 * the hops that led here.
 */
export function decide(
	answer: unknown,
	{
		target,
		base,
		redirects,
		first = false
	}: { target: URL; base: string; redirects: number; first?: boolean }
): GuardDecision {
	if (answer === false) return first ? { action: 'allow' } : { action: 'cancel' };
	if (typeof answer !== 'string') return { action: 'allow' };
	if (redirects >= MAX_REDIRECTS)
		return {
			action: 'stop',
			error: new Error(
				`onNavigate redirected more than ${MAX_REDIRECTS} times; stopped at ${answer}.`
			)
		};
	// An app path: `//host/…` or `https://…` would leave the app (an open redirect if a guard
	// builds its answer from the URL), and `\` counts as `/` in URLs.
	const url = /^\/(?![/\\])/.test(answer) ? new URL(base + answer, target) : undefined;
	if (!url || url.origin !== target.origin)
		return {
			action: 'stop',
			error: new Error(`onNavigate answered ${JSON.stringify(answer)}, which isn't an app path.`)
		};
	return { action: 'redirect', url, redirects: redirects + 1 };
}

/**
 * The app path of a request the service worker handles (GETs on its origin, under the base
 * path), or null for one it leaves to the browser.
 */
export function workerPath(request: Request, origin: string, base: string): string | null {
	const url = new URL(request.url);
	if (request.method !== 'GET' || url.origin !== origin) return null;
	return stripBase(url.pathname, base);
}
