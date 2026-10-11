/**
 * `buildTestWorker()`: the real service worker runtime (`startWorker()` from
 * `@xcwds/sveltekit/worker`, with the default strategy) and a plugin list, without a browser.
 * Its install, activate, message and fetch events are dispatched by the test. While it is open,
 * `caches` and `fetch` are the worker's: the caches in memory, and `fetch` answered by the
 * `network` option (there is no network in tests).
 */
import type { App, LogLevel } from '@xcwds/core';
import {
	startWorker,
	type ExtendableEvent,
	type FetchEvent,
	type MessageEvent,
	type WorkerScope
} from '@xcwds/sveltekit/worker';
import { allows, refused } from '@xcwds/sveltekit/guard';
import { closeAfterTest, ErrorTrap } from './errors.js';
import { prepare, type Importer, type TestInput } from './plugins.js';

type Network = (request: Request) => Response | Promise<Response>;

export type TestWorkerOptions = {
	/** SvelteKit's `paths.base`. String paths you pass never include it. */
	base?: string;
	/** `$service-worker`'s lists (paths with the base), to precache. Empty by default. */
	build?: string[];
	files?: string[];
	prerendered?: string[];
	/** Files the integration emits (manifest, icons), relative to the base. */
	assets?: string[];
	/** The build version, which names the cache. Defaults to `test`. */
	version?: string;
	/** The origin requests are made on. Defaults to `http://localhost`. */
	origin?: string;
	/**
	 * Answers `fetch()` and `cache.add()` / `addAll()` while the worker is open. By default
	 * every request fails, as offline. As in the built worker (#55), requests to an origin that
	 * isn't the app's own, one the plugins declare (`network.origins`) or `allowOrigins` fail
	 * without reaching it.
	 */
	network?: Network;
	/** More origins the worker may contact, like the config's `privacy.allowOrigins`. */
	allowOrigins?: string[];
	import?: Importer;
	/** Errors reported to `onError` make the next operation reject; see `buildTestApp`. */
	strict?: boolean;
	logLevel?: LogLevel;
};

const offline: Network = (request) => {
	throw new TypeError(`No network in tests (${request.url}); pass \`network\` to answer it.`);
};

const withoutSearch = (url: string) => {
	const u = new URL(url);
	u.search = '';
	return u.href;
};

/** The part of the Cache API plugins use, kept in memory, with the real one's checks. */
export class MemoryCache {
	readonly #entries = new Map<string, Response>();
	readonly #network: Network;
	readonly #origin: string;

	constructor(origin: string, network: Network = offline) {
		this.#origin = origin;
		this.#network = network;
	}

	#request(request: RequestInfo | URL): Request {
		return request instanceof Request
			? request
			: new Request(new URL(String(request), this.#origin));
	}

	async match(
		request: RequestInfo | URL,
		options: { ignoreMethod?: boolean; ignoreSearch?: boolean } = {}
	): Promise<Response | undefined> {
		const req = this.#request(request);
		if (req.method !== 'GET' && !options.ignoreMethod) return undefined;
		if (!options.ignoreSearch) return this.#entries.get(req.url)?.clone();
		const want = withoutSearch(req.url);
		for (const [url, response] of this.#entries)
			if (withoutSearch(url) === want) return response.clone();
		return undefined;
	}
	async put(request: RequestInfo | URL, response: Response): Promise<void> {
		const req = this.#request(request);
		check(req, response);
		this.#entries.set(req.url, response.clone());
	}
	async add(request: RequestInfo | URL): Promise<void> {
		await this.addAll([request]);
	}
	/** Fetches every request, then stores them all, or nothing if one fails. */
	async addAll(requests: (RequestInfo | URL)[]): Promise<void> {
		const list = requests.map((r) => this.#request(r));
		const urls = new Set<string>();
		for (const req of list) {
			if (req.method !== 'GET')
				throw new TypeError(`Only GET requests can be cached (${req.url}).`);
			if (urls.has(req.url))
				throw new DOMException(`${req.url} is in the list twice.`, 'InvalidStateError');
			urls.add(req.url);
		}
		const responses = await Promise.all(list.map((req) => this.#network(req)));
		responses.forEach((response, i) => {
			if (!response.ok)
				throw new TypeError(`Request for ${list[i]!.url} failed: ${response.status}`);
			check(list[i]!, response);
		});
		list.forEach((req, i) => this.#entries.set(req.url, responses[i]!.clone()));
	}
	async delete(request: RequestInfo | URL): Promise<boolean> {
		return this.#entries.delete(this.#request(request).url);
	}
	async keys(): Promise<Request[]> {
		return [...this.#entries.keys()].map((url) => new Request(url));
	}
}

function check(request: Request, response: Response) {
	if (request.method !== 'GET')
		throw new TypeError(`Only GET requests can be cached (${request.url}).`);
	if (response.status === 206)
		throw new TypeError(`A partial response can't be cached (${request.url}).`);
	const vary = response.headers.get('vary') ?? '';
	if (vary.split(',').some((v) => v.trim() === '*'))
		throw new TypeError(`A response with "Vary: *" can't be cached (${request.url}).`);
}

/** `CacheStorage` in memory. */
export class MemoryCacheStorage {
	readonly #caches = new Map<string, MemoryCache>();
	readonly #origin: string;
	readonly #network: Network;

	constructor(origin: string, network: Network = offline) {
		this.#origin = origin;
		this.#network = network;
	}

	async open(name: string): Promise<MemoryCache> {
		let cache = this.#caches.get(name);
		if (!cache) this.#caches.set(name, (cache = new MemoryCache(this.#origin, this.#network)));
		return cache;
	}
	async has(name: string): Promise<boolean> {
		return this.#caches.has(name);
	}
	async delete(name: string): Promise<boolean> {
		return this.#caches.delete(name);
	}
	async keys(): Promise<string[]> {
		return [...this.#caches.keys()];
	}
	async match(
		request: RequestInfo | URL,
		options: { cacheName?: string; ignoreMethod?: boolean; ignoreSearch?: boolean } = {}
	): Promise<Response | undefined> {
		const names = options.cacheName ? [options.cacheName] : this.#caches.keys();
		for (const name of names) {
			const found = await this.#caches.get(name)?.match(request, options);
			if (found) return found;
		}
		return undefined;
	}
}

export type TestWorker = {
	app: App;
	/** The worker's caches (also `globalThis.caches` while it is open). */
	caches: MemoryCacheStorage;
	/** This version's cache (what `onInstall` hooks get). */
	cache: MemoryCache;
	/** Every error reported to `onError`, in order. */
	errors: readonly unknown[];
	/** Whether a plugin called `skipWaiting()`. */
	readonly skippedWaiting: boolean;
	/**
	 * Dispatches a `fetch` event: resolves to the worker's response, or `undefined` when it
	 * leaves the request to the browser (non-GETs, other origins, paths outside the app). A
	 * string is an app path (without the base); `init.mode: 'navigate'` makes a navigation.
	 */
	fetch(input: Request | string, init?: RequestInit): Promise<Response | undefined>;
	/** Dispatches `install` (precaching, then `onInstall` hooks). */
	install(): Promise<MemoryCache>;
	/** Dispatches `activate` (old caches deleted, then `onActivate` hooks). */
	activate(): Promise<void>;
	/** Dispatches a `message` event (`onMessage` hooks). */
	message(data: unknown): Promise<void>;
	/** Closes the app and puts the real `caches` and `fetch` back. */
	close(): Promise<void>;
};

/** The test worker whose `caches` and `fetch` are installed, if one is. */
let active: TestWorker | null = null;

function stubGlobals(stubs: Record<string, unknown>): () => void {
	const saved = Object.keys(stubs).map(
		(key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
	);
	for (const [key, value] of Object.entries(stubs))
		Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
	return () => {
		for (const [key, descriptor] of saved)
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete (globalThis as Record<string, unknown>)[key];
	};
}

type Listener = (event: never) => void;

/** A `ServiceWorkerGlobalScope` stand-in whose events the test dispatches. */
function fakeScope(origin: string, base: string) {
	const listeners = new Map<string, Listener[]>();
	const state = { skippedWaiting: false };
	const scope: WorkerScope = {
		location: { origin },
		registration: { scope: `${origin}${base}/` },
		clients: { claim: async () => {} },
		skipWaiting: async () => void (state.skippedWaiting = true),
		addEventListener(type: string, listener: Listener) {
			listeners.set(type, [...(listeners.get(type) ?? []), listener]);
		}
	};
	/** Dispatches an event; resolves once everything it waits for has settled. */
	async function dispatch(type: string, extra: object): Promise<Promise<Response> | undefined> {
		const waits: Promise<unknown>[] = [];
		let response: Promise<Response> | undefined;
		const event = Object.assign(new Event(type), extra, {
			waitUntil: (promise: Promise<unknown>) => void waits.push(promise),
			respondWith: (r: Response | Promise<Response>) => void (response = Promise.resolve(r))
		});
		for (const listener of listeners.get(type) ?? []) listener(event as never);
		// A response can add work (e.g. caching it); wait for that too.
		const settled = response?.catch(() => undefined);
		await settled;
		await Promise.all(waits);
		return response;
	}
	return { scope, state, dispatch };
}

/**
 * Boots a worker for a unit test: plugin functions, pairs, or descriptors (their `./worker`),
 * on the integration's real runtime. One test worker is open at a time. Inside a test it closes
 * when the test finishes.
 */
export async function buildTestWorker(
	input: TestInput,
	options: TestWorkerOptions = {}
): Promise<TestWorker> {
	if (active) throw new Error('Another test worker is open; close it first.');
	const base = options.base ?? '';
	const origin = new URL(options.origin ?? 'http://localhost').origin;
	const logLevel = options.logLevel ?? 'warn';
	const prepared = await prepare(input, 'worker', { importer: options.import, logLevel });
	const allowed = [...prepared.origins, ...(options.allowOrigins ?? [])];
	const answer = options.network ?? offline;
	const network: Network = (request) =>
		allows(request, origin, allowed) ? answer(request) : Promise.reject(refused(request, origin));
	if (active) throw new Error('Another test worker is open; close it first.');
	const caches = new MemoryCacheStorage(origin, network);
	const { scope, state, dispatch } = fakeScope(origin, base);
	const trap = new ErrorTrap(options.strict ?? true);
	const restore = stubGlobals({
		caches,
		fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
			network(
				input instanceof Request && !init
					? input
					: new Request(input instanceof Request ? input : new URL(String(input), origin), init)
			)
	});
	let app: App;
	try {
		app = startWorker(
			{
				base,
				build: options.build ?? [],
				files: options.files ?? [],
				prerendered: options.prerendered ?? [],
				assets: options.assets ?? [],
				version: options.version ?? 'test',
				name: prepared.name,
				// Undefined keeps the kernel's default prefix.
				storagePrefix: prepared.storagePrefix as string,
				routes: prepared.routes,
				plugins: prepared.plugins,
				logLevel
			},
			scope
		);
	} catch (error) {
		restore();
		throw error;
	}
	trap.watch(app);
	const cache = await caches.open(app.worker!.cacheName);
	let closed = false;
	const worker: TestWorker = {
		app,
		caches,
		cache,
		errors: trap.errors,
		get skippedWaiting() {
			return state.skippedWaiting;
		},
		fetch: (input, init) =>
			trap.run(async () => {
				const { mode, ...rest } = init ?? {};
				const request =
					typeof input === 'string'
						? new Request(new URL(base + input, origin), rest)
						: init
							? new Request(input, rest)
							: input;
				// Node's Request can't be made a navigation; the worker only reads `mode`.
				if (mode) Object.defineProperty(request, 'mode', { value: mode });
				return dispatch('fetch', { request } satisfies Partial<FetchEvent>);
			}),
		install: () =>
			trap.run(async () => {
				await dispatch('install', {} satisfies Partial<ExtendableEvent>);
				return cache;
			}),
		activate: () => trap.run(async () => void (await dispatch('activate', {}))),
		message: (data) =>
			trap.run(
				async () => void (await dispatch('message', { data } satisfies Partial<MessageEvent>))
			),
		async close() {
			if (closed) return;
			closed = true;
			try {
				await app.close();
			} finally {
				restore();
				active = null;
			}
			trap.check();
		}
	};
	active = worker;
	try {
		await app.ready();
		trap.check();
	} catch (error) {
		await worker.close().catch(() => {});
		throw error;
	}
	closeAfterTest(() => worker.close());
	return worker;
}
