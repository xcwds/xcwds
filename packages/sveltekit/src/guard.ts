/**
 * `@xcwds/sveltekit/guard`: keeps the service worker to the origins the app declares (#55).
 *
 * A page's `<meta>` Content-Security-Policy doesn't reach the service worker: a worker's policy
 * comes only from the HTTP headers its script was served with, and static hosts like GitHub
 * Pages send none. So the generated `.xcwds/worker.js` imports a module that calls
 * `guardNetwork()` before any plugin's worker code is evaluated. It wraps `fetch`, `WebSocket`,
 * `EventSource`, `WebTransport`, `Cache#add`/`addAll` and background fetches so they refuse any
 * origin other than the app's own, the ones plugins declare (`network.origins`) and
 * `privacy.allowOrigins`, the same list the page's `connect-src` gets. This is defence in depth,
 * not a sandbox: plugins are trusted code.
 */

/** The parts of a worker's global scope the guard replaces (tests pass their own). */
export type GuardScope = {
	location: { origin: string };
	fetch?: typeof fetch;
	WebSocket?: new (url: string | URL, protocols?: string | string[]) => unknown;
	EventSource?: new (url: string | URL, init?: unknown) => unknown;
	WebTransport?: new (url: string | URL, options?: unknown) => unknown;
	Cache?: {
		prototype: {
			add?(request: RequestInfo | URL): Promise<void>;
			addAll?(requests: Iterable<RequestInfo | URL>): Promise<void>;
		};
	};
	BackgroundFetchManager?: {
		prototype: {
			fetch?(
				id: string,
				requests: RequestInfo | URL | Iterable<RequestInfo | URL>,
				options?: unknown
			): Promise<unknown>;
		};
	};
};

const LOCAL = new Set(['data:', 'blob:']);
const WEB: Record<string, string> = { 'ws:': 'http:', 'wss:': 'https:' };

const href = (input: unknown): string =>
	typeof input === 'object' && input !== null && 'url' in input
		? String((input as { url: unknown }).url)
		: String(input);

/** The origin `input` (a URL, string or `Request`) points at, resolved against `self`. */
function originOf(input: unknown, self: string): { origin: string; local: boolean } | null {
	let url: URL;
	try {
		url = new URL(href(input), `${self}/`);
	} catch {
		return null;
	}
	if (LOCAL.has(url.protocol)) return { origin: url.protocol, local: true };
	// WebSocket URLs count as their web origin, as `connect-src` treats them.
	const protocol = WEB[url.protocol] ?? url.protocol;
	return { origin: `${protocol}//${url.host}`, local: false };
}

/**
 * Whether the guard lets a request to `input` through: the app's own origin, `data:`/`blob:`,
 * and the `allowed` origins. A URL that doesn't parse is left to the API to reject.
 */
export function allows(input: unknown, self: string, allowed: Iterable<string>): boolean {
	const target = originOf(input, self);
	if (!target || target.local || target.origin === self) return true;
	for (const origin of allowed) if (originOf(origin, self)?.origin === target.origin) return true;
	return false;
}

/** The error a refused request fails with, naming the origin. */
export function refused(input: unknown, self: string): TypeError {
	const origin = originOf(input, self)?.origin ?? href(input);
	return new TypeError(
		`@xcwds blocked a request to ${origin} from the service worker: no plugin declares it (network.origins) and privacy.allowOrigins doesn't list it.`
	);
}

/** `fetch`, refusing origins the app doesn't declare. */
export function guardFetch<
	F extends (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>(fetchFn: F, self: string, allowed: readonly string[]): F {
	return ((input: RequestInfo | URL, init?: RequestInit) =>
		allows(input, self, allowed)
			? fetchFn(input, init)
			: Promise.reject(refused(input, self))) as F;
}

/** Installs the guard on `scope` (the service worker's `self`). */
export function guardNetwork(scope: GuardScope, allowed: readonly string[]): void {
	const self = scope.location.origin;
	const check = (input: unknown) => {
		if (!allows(input, self, allowed)) throw refused(input, self);
	};
	if (scope.fetch) scope.fetch = guardFetch(scope.fetch.bind(scope), self, allowed);
	for (const name of ['WebSocket', 'EventSource', 'WebTransport'] as const) {
		const Original = scope[name];
		if (!Original) continue;
		const Guarded = class extends (Original as new (...args: unknown[]) => object) {
			constructor(...args: unknown[]) {
				check(args[0]);
				super(...args);
			}
		};
		Object.defineProperty(Guarded, 'name', { value: name });
		scope[name] = Guarded as never;
	}
	const cache = scope.Cache?.prototype;
	if (cache?.add) {
		const add = cache.add;
		cache.add = function (request) {
			try {
				check(request);
			} catch (error) {
				return Promise.reject(error);
			}
			return add.call(this, request);
		};
	}
	if (cache?.addAll) {
		const addAll = cache.addAll;
		cache.addAll = function (requests) {
			// Not a sequence (a string by mistake): the real one rejects it, as it should.
			if (typeof requests !== 'object' || requests === null) return addAll.call(this, requests);
			let list: (RequestInfo | URL)[];
			try {
				// Copied first: a generator would be used up by the check.
				list = [...requests];
				for (const request of list) check(request);
			} catch (error) {
				return Promise.reject(error);
			}
			return addAll.call(this, list);
		};
	}
	// `registration.backgroundFetch.fetch()` downloads any requests it's given (Chromium).
	const background = scope.BackgroundFetchManager?.prototype;
	if (background?.fetch) {
		const fetchAll = background.fetch;
		background.fetch = function (id, requests, options) {
			const list =
				typeof requests === 'string' || requests instanceof URL || !isIterable(requests)
					? [requests]
					: [...requests];
			try {
				for (const request of list) check(request);
			} catch (error) {
				return Promise.reject(error);
			}
			return fetchAll.call(this, id, list, options);
		};
	}
}

const isIterable = (value: unknown): value is Iterable<unknown> =>
	typeof value === 'object' && value !== null && Symbol.iterator in value;
