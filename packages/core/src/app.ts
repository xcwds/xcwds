import { XcwdsError, codes } from './errors.js';
import {
	KNOWN_HOOKS,
	ROUTE_HOOKS,
	underPrefix,
	type ErrorSource,
	type HookName,
	type Hooks
} from './hooks.js';
import { createLogger, type LogLevel, type Logger } from './log.js';
import { resolveNetwork, type NetworkDeclaration } from './privacy.js';
import { satisfies, validRange } from './semver.js';
import { createSettings, type SettingsRegistry, type SettingsScope } from './settings.js';
import {
	createStorage,
	type StorageAdapter,
	type StorageRegistry,
	type StorageScope
} from './storage.js';
import { VERSION } from './version.js';

// ---------------------------------------------------------------------------------------------
// Plugins

export type PluginMeta<Options = Record<string, unknown>> = {
	/** Unique name, usually the package name (`@xcwds/plugin-timers`). */
	name?: string;
	/** Semver range of @xcwds/core this plugin supports, checked at boot. */
	core?: string;
	/** Plugins that must be registered (in this scope or above) before this one. */
	dependencies?: string[];
	/** Decorators that must already exist where this plugin is registered. */
	decorators?: string[];
	/**
	 * `true` (default): decorators this plugin adds are only visible to it and its children.
	 * `false`: they reach the scope it was registered in, like `fastify-plugin`.
	 */
	encapsulate?: boolean;
	/**
	 * Network use (#22): `false` (the default) or the `https:`/`wss:` origins it contacts and
	 * why. Checked when the plugin loads; the build fails on origins plugins don't declare, and the
	 * page's CSP only allows declared ones. A function works it out from the options the plugin is
	 * registered with (without `prefix`), for origins the app picks; see `resolveNetwork`.
	 */
	network?: NetworkDeclaration<Options>;
	/** Storage namespace (`app:<namespace>:<key>`). Defaults to a short form of `name`. */
	namespace?: string;
};

/** Options every plugin accepts, like Fastify's `prefix`. */
export type RegisterOptions = { prefix?: string };

export type PluginFunction<Options = Record<string, unknown>> = (
	app: App,
	options: Options
) => void | Promise<void>;

export type Plugin<Options = Record<string, unknown>> = PluginFunction<Options> & {
	readonly [META]?: PluginMeta;
};

const META = Symbol.for('xcwds.plugin-meta');

/** Attaches metadata to a plugin function, like `fastify-plugin`. */
export function definePlugin<Options = Record<string, unknown>>(
	fn: PluginFunction<Options>,
	meta: PluginMeta<NoInfer<Options>> = {}
): Plugin<Options> {
	if (typeof fn !== 'function')
		throw new XcwdsError(codes.PLUGIN_NOT_A_FUNCTION, 'definePlugin() needs a function.', {
			plugin: meta.name
		});
	Object.defineProperty(fn, META, { value: { ...meta }, enumerable: false });
	return fn as Plugin<Options>;
}

/** The metadata `definePlugin` attached, or `{}`. */
export function pluginMeta(plugin: Plugin<never>): PluginMeta {
	return (plugin as { [META]?: PluginMeta })[META] ?? {};
}

/** `@xcwds/plugin-timers` → `timers`, `xcwds-plugin-foo` → `foo`, `my-thing` → `my-thing`. */
export function defaultNamespace(name: string): string {
	return name
		.replace(/^@[^/]+\//, '')
		.replace(/^(xcwds-)?plugin-/, '')
		.replace(/[^a-z0-9-]+/gi, '-')
		.toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// The app

type HookRecord = {
	name: string;
	fn: (...args: never[]) => unknown;
	plugin: string;
	prefix: string;
};

type HookResult<K extends HookName> = Awaited<ReturnType<Hooks[K]>>;

/** Runs hooks. Errors thrown by a hook are reported to `onError` and the next hook still runs. */
export type HookRunner = {
	/** Runs every `name` hook in registration order. */
	run<K extends HookName>(
		name: K,
		args: Parameters<Hooks[K]>,
		options?: { path?: string; reverse?: boolean }
	): Promise<void>;
	/** Runs hooks until one returns something other than `undefined`, and returns that. */
	first<K extends HookName>(
		name: K,
		args: Parameters<Hooks[K]>,
		options?: { path?: string }
	): Promise<Exclude<HookResult<K>, void | undefined> | undefined>;
	/**
	 * Like `first`, but synchronous for as long as the hooks are: it returns the answer directly
	 * when every hook up to the one that answers returns a plain value, and a promise once one
	 * returns a promise. For callers that must decide inline when they can (navigation guards).
	 */
	firstNow<K extends HookName>(
		name: K,
		args: Parameters<Hooks[K]>,
		options?: { path?: string }
	):
		| Exclude<Awaited<ReturnType<Hooks[K]>>, void | undefined>
		| undefined
		| Promise<Exclude<Awaited<ReturnType<Hooks[K]>>, void | undefined> | undefined>;
	/** Runs every hook and returns the results that aren't `undefined`. */
	collect<K extends HookName>(
		name: K,
		args: Parameters<Hooks[K]>,
		options?: { path?: string }
	): Promise<Exclude<HookResult<K>, void | undefined>[]>;
	/**
	 * Passes a value through every hook in order, like a waterfall: each gets the latest value
	 * (plus `rest`) and may return a replacement. A hook that returns nothing (or throws) leaves it
	 * as it was. Used for `onConfig` and `onManifest`.
	 */
	reduce<K extends HookName>(
		name: K,
		value: Parameters<Hooks[K]>[0],
		rest?: Parameters<Hooks[K]> extends [unknown, ...infer R] ? R : [],
		options?: { path?: string }
	): Promise<Parameters<Hooks[K]>[0]>;
	/** The plugins with a `name` hook (for a path, for route hooks). */
	plugins(name: HookName, options?: { path?: string }): string[];
};

/**
 * The app as a plugin sees it. Plugins add typed decorators by merging into this interface:
 *
 *   declare module '@xcwds/core' { interface App { toast(message: string): void } }
 */
export interface App {
	/** The version of @xcwds/core. */
	readonly version: string;
	/** The name of the plugin this view belongs to (`''` at the root). */
	readonly pluginName: string;
	/** The route prefix this plugin was registered under, including its parents' (`''` if none). */
	readonly prefix: string;
	/** Local console logging; never sent anywhere. */
	readonly log: Logger;
	/** This plugin's storage namespace (`app:<namespace>:<key>`). */
	readonly storage: StorageScope;
	/** App-wide settings; `field()` records which plugin added a field. */
	readonly settings: SettingsScope;
	readonly hooks: HookRunner;

	register<Options>(plugin: Plugin<Options>, options?: Options & RegisterOptions): App;
	/**
	 * Loads every registered plugin, depth-first, in order. Safe to call more than once: later calls
	 * share the first one's result. If loading fails, every later call rejects with that error, so
	 * create a new app to try again.
	 */
	load(): Promise<App>;
	/** Loads plugins, then runs `onReady` hooks once. */
	ready(): Promise<App>;
	/** Runs `onClose` hooks in reverse order, once. */
	close(): Promise<void>;

	addHook<K extends HookName>(name: K, fn: Hooks[K]): App;
	/** Declares a custom hook name a plugin will run with `app.hooks`. */
	defineHook(name: string, options?: { route?: boolean }): App;

	/** Adds a property every view in this scope can read. Merged `App` fields are type-checked. */
	decorate<K extends string>(name: K, value: K extends keyof App ? App[K] : unknown): App;
	hasDecorator(name: string): boolean;

	/** Reports an error to `onError` hooks (or the log when there are none). */
	reportError(error: unknown, source?: ErrorSource): Promise<void>;
}

export type AppOptions = {
	/** Per-plugin load timeout in ms (Fastify's `pluginTimeout`). 0 turns it off. */
	pluginTimeout?: number;
	logLevel?: LogLevel;
	/** Where data is saved; defaults to `localStorage` when there is one. */
	storage?: StorageAdapter;
	/** Storage key prefix. */
	storagePrefix?: string;
	/** Name written into backups, and checked when importing one. */
	appName?: string;
	/** The core version plugins are checked against (tests only). */
	coreVersion?: string;
};

type Kernel = {
	version: string;
	timeout: number;
	log: Logger;
	hooks: HookRecord[];
	customHooks: Set<string>;
	/** Storage namespace → the plugin that owns it. */
	namespaces: Map<string, string>;
	routeHooks: Set<string>;
	runner: HookRunner;
	storage: StorageRegistry;
	settings: SettingsRegistry;
	loading: Promise<void> | null;
	loaded: boolean;
	ready: Promise<void> | null;
	closing: Promise<void> | null;
};

type QueueItem = { plugin: Plugin<never>; options: Record<string, unknown> };

type Scope = { registered: Set<string> };

type State = {
	kernel: Kernel;
	parent: State | null;
	/** Where `decorate` puts properties: this view, or the nearest encapsulating ancestor's. */
	target: object;
	scope: Scope;
	plugin: string;
	prefix: string;
	namespace: string;
	queue: QueueItem[];
	/** Set once this plugin's queue has been loaded; registering on it after that is an error. */
	drained: boolean;
};

const states = new WeakMap<object, State>();

function state(app: object): State {
	const s = states.get(app);
	if (!s) throw new TypeError('Not an @xcwds app.');
	return s;
}

const RESERVED = new Set<string>([
	'version',
	'pluginName',
	'prefix',
	'log',
	'storage',
	'settings',
	'hooks',
	'register',
	'load',
	'ready',
	'close',
	'addHook',
	'defineHook',
	'decorate',
	'hasDecorator',
	'reportError'
]);

function joinPrefix(parent: string, child: string | undefined): string {
	if (!child) return parent;
	const joined = `${parent}/${child}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
	return joined.startsWith('/') ? joined : `/${joined}`;
}

function isRegistered(s: State | null, name: string): boolean {
	for (let at = s; at; at = at.parent) if (at.scope.registered.has(name)) return true;
	return false;
}

function withTimeout<T>(promise: Promise<T>, ms: number, plugin: string): Promise<T> {
	if (!ms) return promise;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new XcwdsError(
						codes.PLUGIN_TIMEOUT,
						`Plugin "${plugin}" didn't finish loading in ${ms} ms.`,
						{
							plugin
						}
					)
				),
			ms
		);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const proto: App = {
	get version() {
		return state(this).kernel.version;
	},
	get pluginName() {
		return state(this).plugin;
	},
	get prefix() {
		return state(this).prefix;
	},
	get log() {
		return state(this).kernel.log;
	},
	get hooks() {
		return state(this).kernel.runner;
	},
	// `storage` and `settings` are own properties of each view (see `view()`).
	storage: undefined as never,
	settings: undefined as never,

	register(plugin, options) {
		const s = state(this);
		const k = s.kernel;
		if (k.closing) throw new XcwdsError(codes.CLOSED, "Can't register plugins on a closed app.");
		if (k.loaded)
			throw new XcwdsError(
				codes.ALREADY_BOOTED,
				`Can't register "${pluginMeta(plugin as Plugin<never>).name ?? 'a plugin'}" after the app has loaded.`
			);
		if (typeof plugin !== 'function')
			throw new XcwdsError(codes.PLUGIN_NOT_A_FUNCTION, 'A plugin must be a function.');
		if (s.drained)
			throw new XcwdsError(
				codes.ALREADY_BOOTED,
				`Can't register "${pluginMeta(plugin as Plugin<never>).name ?? 'a plugin'}" from "${s.plugin}" after it has finished loading. Register plugins before your plugin's function returns.`,
				{ plugin: s.plugin || undefined }
			);
		s.queue.push({
			plugin: plugin as Plugin<never>,
			options: { ...(options as Record<string, unknown> | undefined) }
		});
		return this;
	},

	load() {
		const s = state(this);
		const k = s.kernel;
		const root = rootState(s);
		k.loading ??= drain(root).then(() => {
			k.loaded = true;
			// Every plugin has added its settings fields: read the saved values.
			k.settings.load();
		});
		return k.loading.then(() => this);
	},

	ready() {
		const k = state(this).kernel;
		k.ready ??= this.load().then(() => k.runner.run('onReady', []));
		return k.ready.then(() => this);
	},

	close() {
		const k = state(this).kernel;
		k.closing ??= (async () => {
			await k.runner.run('onClose', [], { reverse: true });
			k.storage.stopSync();
		})();
		return k.closing;
	},

	addHook(name, fn) {
		const s = state(this);
		const k = s.kernel;
		if (!KNOWN_HOOKS.has(name) && !k.customHooks.has(name))
			throw new XcwdsError(codes.HOOK_INVALID, `Unknown hook "${String(name)}".`, {
				plugin: s.plugin || undefined
			});
		if (typeof fn !== 'function')
			throw new XcwdsError(codes.HOOK_INVALID, `The "${String(name)}" hook must be a function.`, {
				plugin: s.plugin || undefined
			});
		k.hooks.push({
			name,
			fn: fn as HookRecord['fn'],
			plugin: s.plugin,
			prefix: s.prefix
		});
		return this;
	},

	defineHook(name, options = {}) {
		const k = state(this).kernel;
		if (KNOWN_HOOKS.has(name) || k.customHooks.has(name))
			throw new XcwdsError(codes.HOOK_INVALID, `The hook "${name}" already exists.`);
		k.customHooks.add(name);
		if (options.route) k.routeHooks.add(name);
		return this;
	},

	decorate(name: string, value: unknown): App {
		const s = state(this);
		if (RESERVED.has(name) || name in Object.prototype)
			throw new XcwdsError(codes.DECORATOR_RESERVED, `"${name}" is part of the app's own API.`, {
				plugin: s.plugin || undefined
			});
		if (name in this)
			throw new XcwdsError(codes.DECORATOR_EXISTS, `The decorator "${name}" already exists.`, {
				plugin: s.plugin || undefined
			});
		Object.defineProperty(s.target, name, {
			value,
			enumerable: true,
			writable: true,
			configurable: false
		});
		return this;
	},

	hasDecorator(name) {
		if (RESERVED.has(name) || name in Object.prototype) return false;
		// Decorators are own properties of the views up the chain; `proto` and Object.prototype
		// (`toString`, `isPrototypeOf`…) hold none.
		if (Object.hasOwn(this, name)) return true;
		let at: object | null = Object.getPrototypeOf(this);
		while (at && at !== proto) {
			if (Object.hasOwn(at, name)) return true;
			at = Object.getPrototypeOf(at);
		}
		return false;
	},

	reportError(error, source = { kind: 'uncaught' }) {
		return report(state(this).kernel, error, source);
	}
};

async function report(k: Kernel, error: unknown, source: ErrorSource): Promise<void> {
	const handlers = k.hooks.filter((h) => h.name === 'onError');
	if (handlers.length === 0) {
		k.log.error(error);
		return;
	}
	for (const h of handlers) {
		try {
			await (h.fn as Hooks['onError'])(error, source);
		} catch (inner) {
			// An error handler that throws is logged, never re-reported (that could loop).
			k.log.error(
				`The onError hook from "${h.plugin || 'the app'}" failed:`,
				inner,
				'while handling:',
				error
			);
		}
	}
}

function createRunner(getKernel: () => Kernel): HookRunner {
	const select = (name: string, path: string | undefined) => {
		const k = getKernel();
		const route = (ROUTE_HOOKS as readonly string[]).includes(name) || k.routeHooks.has(name);
		return k.hooks.filter(
			(h) => h.name === name && (!route || path === undefined || underPrefix(path, h.prefix))
		);
	};
	async function call(h: HookRecord, args: unknown[]): Promise<{ ok: boolean; value?: unknown }> {
		try {
			return { ok: true, value: await (h.fn as (...a: unknown[]) => unknown)(...args) };
		} catch (cause) {
			await fail(h, cause);
			return { ok: false };
		}
	}
	async function fail(h: HookRecord, cause: unknown): Promise<void> {
		const k = getKernel();
		const plugin = h.plugin || 'the app';
		const error = new XcwdsError(
			codes.HOOK_FAILED,
			`The ${h.name} hook from "${plugin}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ plugin: h.plugin || undefined, cause }
		);
		if (h.name === 'onError') k.log.error(error);
		else await report(k, error, { kind: 'hook', hook: h.name as HookName, plugin });
	}
	return {
		async run(name, args, options = {}) {
			const list = select(name, options.path);
			if (options.reverse) list.reverse();
			for (const h of list) await call(h, args);
		},
		async first(name, args, options = {}) {
			for (const h of select(name, options.path)) {
				const r = await call(h, args);
				if (r.ok && r.value !== undefined) return r.value as never;
			}
			return undefined;
		},
		firstNow(name, args, options = {}) {
			const list = select(name, options.path);
			for (let i = 0; i < list.length; i++) {
				const h = list[i]!;
				let value: unknown;
				try {
					value = (h.fn as (...a: unknown[]) => unknown)(...args);
				} catch (cause) {
					void fail(h, cause);
					continue;
				}
				if (typeof (value as PromiseLike<unknown> | undefined)?.then === 'function') {
					const pending = value as PromiseLike<unknown>;
					return (async () => {
						try {
							const v = await pending;
							if (v !== undefined) return v;
						} catch (cause) {
							await fail(h, cause);
						}
						for (const rest of list.slice(i + 1)) {
							const r = await call(rest, args);
							if (r.ok && r.value !== undefined) return r.value;
						}
						return undefined;
					})() as never;
				}
				if (value !== undefined) return value as never;
			}
			return undefined;
		},
		async collect(name, args, options = {}) {
			const out: unknown[] = [];
			for (const h of select(name, options.path)) {
				const r = await call(h, args);
				if (r.ok && r.value !== undefined) out.push(r.value);
			}
			return out as never;
		},
		async reduce(name, value, rest, options = {}) {
			let current: unknown = value;
			for (const h of select(name, options.path)) {
				const r = await call(h, [current, ...((rest as unknown[] | undefined) ?? [])]);
				if (r.ok && r.value !== undefined) current = r.value;
			}
			return current as never;
		},
		plugins(name, options = {}) {
			return select(name, options.path).map((h) => h.plugin);
		}
	};
}

function rootState(s: State): State {
	let at = s;
	while (at.parent) at = at.parent;
	return at;
}

/** A new view of the app for a plugin: inherits decorators from `parent` through the prototype. */
function view(parent: object, s: State): App {
	const app = Object.create(parent) as App;
	states.set(app, s);
	Object.defineProperty(app, 'storage', {
		value: s.kernel.storage.scope(s.namespace),
		enumerable: false
	});
	Object.defineProperty(app, 'settings', {
		value: s.kernel.settings.scope(s.plugin),
		enumerable: false
	});
	return app;
}

const views = new WeakMap<State, App>();

async function drain(s: State): Promise<void> {
	while (s.queue.length) {
		const item = s.queue.shift()!;
		await loadPlugin(s, item);
	}
	s.drained = true;
}

async function loadPlugin(parent: State, { plugin, options }: QueueItem): Promise<void> {
	const k = parent.kernel;
	const meta = pluginMeta(plugin);
	const name = meta.name ?? (plugin.name || 'anonymous plugin');
	const named = meta.name !== undefined;
	const parentView = views.get(parent)!;

	if (meta.core && !validRange(meta.core))
		throw new XcwdsError(
			codes.PLUGIN_META,
			`Plugin "${name}" declares an unsupported @xcwds/core range: "${meta.core}".`,
			{ plugin: name }
		);
	if (meta.core && !satisfies(k.version, meta.core))
		throw new XcwdsError(
			codes.PLUGIN_VERSION_MISMATCH,
			`Plugin "${name}" needs @xcwds/core ${meta.core}, but this is ${k.version}.`,
			{ plugin: name }
		);
	const { prefix, ...pluginOptions } = options as RegisterOptions & Record<string, unknown>;
	resolveNetwork(meta.network, pluginOptions, name);
	if (named && isRegistered(parent, meta.name!))
		throw new XcwdsError(codes.PLUGIN_DUPLICATE, `Plugin "${name}" is already registered here.`, {
			plugin: name
		});
	for (const dep of meta.dependencies ?? []) {
		if (!isRegistered(parent, dep))
			throw new XcwdsError(
				codes.PLUGIN_DEPENDENCY,
				`Plugin "${name}" needs "${dep}", which isn't registered before it.`,
				{ plugin: name }
			);
	}
	for (const decorator of meta.decorators ?? []) {
		if (!parentView.hasDecorator(decorator))
			throw new XcwdsError(
				codes.PLUGIN_DECORATOR_MISSING,
				`Plugin "${name}" needs the "${decorator}" decorator, which doesn't exist here.`,
				{ plugin: name }
			);
	}
	const namespace = meta.namespace ?? (named ? defaultNamespace(meta.name!) : parent.namespace);
	// Plugins share a namespace's storage keys and migration version, so only one may own it.
	if (namespace && (named || meta.namespace !== undefined)) {
		const owner = k.namespaces.get(namespace);
		if (owner !== undefined && owner !== name)
			throw new XcwdsError(
				codes.PLUGIN_NAMESPACE,
				`Plugin "${name}" wants the storage namespace "${namespace}", which "${owner}" already uses. Set a different \`namespace\` in one of them.`,
				{ plugin: name }
			);
		k.namespaces.set(namespace, name);
	}
	if (named) parent.scope.registered.add(meta.name!);

	const encapsulate = meta.encapsulate !== false;
	const s: State = {
		kernel: k,
		parent,
		target: parent.target,
		scope: encapsulate ? { registered: new Set() } : parent.scope,
		plugin: name,
		prefix: joinPrefix(parent.prefix, prefix),
		namespace,
		queue: [],
		drained: false
	};
	const app = view(parentView, s);
	if (encapsulate) s.target = app;
	views.set(s, app);

	try {
		await withTimeout(
			Promise.resolve().then(() => plugin(app, pluginOptions as never)),
			k.timeout,
			name
		);
	} catch (cause) {
		if (cause instanceof XcwdsError) throw cause;
		throw new XcwdsError(
			codes.PLUGIN_FAILED,
			`Plugin "${name}" failed to load: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ plugin: name, cause }
		);
	}
	await drain(s);
}

/** Creates an app. Register plugins on it, then `await app.ready()`. */
export function createApp(options: AppOptions = {}): App {
	const log = createLogger(options.logLevel);
	const kernel = {} as Kernel;
	const storage = createStorage({
		adapter: options.storage,
		prefix: options.storagePrefix,
		appName: options.appName,
		onError: (error) => void report(kernel, error, { kind: 'uncaught' })
	});
	Object.assign(kernel, {
		version: options.coreVersion ?? VERSION,
		timeout: options.pluginTimeout ?? 10_000,
		log,
		hooks: [],
		customHooks: new Set(),
		namespaces: new Map(),
		routeHooks: new Set(),
		runner: createRunner(() => kernel),
		storage,
		settings: createSettings(storage),
		loading: null,
		loaded: false,
		ready: null,
		closing: null
	} satisfies Kernel);
	const root: State = {
		kernel,
		parent: null,
		target: {},
		scope: { registered: new Set() },
		plugin: '',
		prefix: '',
		namespace: '',
		queue: [],
		drained: false
	};
	const app = view(proto, root);
	root.target = app;
	views.set(root, app);
	// Storage changes from other tabs and settings changes reach plugins as hooks.
	storage.onChange((key, value) => void kernel.runner.run('onStorageChange', [key, value]));
	kernel.settings.subscribe(
		(next, prev) => void kernel.runner.run('onSettingsChange', [next, prev])
	);
	return app;
}
