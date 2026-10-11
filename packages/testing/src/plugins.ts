/**
 * Turns what a test lists into kernel plugins: plugin functions as they are, and descriptors
 * (`timers()`) loaded from their package's entries like the integration loads them.
 */
import {
	createApp,
	definePlugin,
	memoryStorage,
	pluginMeta,
	resolveConfig,
	type Descriptor,
	type LogLevel,
	type Plugin,
	type XcwdsConfig
} from '@xcwds/core';
import { decorateRoutes, type RouteInfo } from '@xcwds/sveltekit/routes';

/** A plugin function, a `[plugin, options]` pair, or a descriptor from a plugin's factory. */
export type TestPlugin =
	Plugin<never> | readonly [Plugin<never>, Record<string, unknown>] | Descriptor<object>;

/** A whole `xcwds.config` (validated like the real one), or just a list of plugins. */
export type TestInput = XcwdsConfig | { plugins: TestPlugin[] };

/**
 * Imports a module by specifier. Pass `(id) => import(id)` from your test file so plugin
 * packages resolve from your package (and Vitest transforms them, `.svelte` files included).
 */
export type Importer = (specifier: string) => Promise<Record<string, unknown>>;

export type Entry = 'client' | 'worker';

export type Prepared = {
	name: string;
	storagePrefix: string | undefined;
	/** The name backups carry (`storage.appName`), when it isn't the brand name. */
	appName: string | undefined;
	plugins: [Plugin<never>, Record<string, unknown>][];
	routes: RouteInfo[];
	/** The origins the plugins declare (`network.origins`) and `privacy.allowOrigins` lists. */
	origins: string[];
};

const defaultImporter: Importer = (specifier) => import(specifier);

function isDescriptor(p: TestPlugin): p is Descriptor<object> {
	return typeof p === 'object' && !Array.isArray(p) && typeof (p as Descriptor).name === 'string';
}

/** Whether `error` says the package has no such export (rather than failing inside it). */
function notExported(error: unknown, specifier: string): boolean {
	const e = error as { code?: string; message?: string } | null;
	if (e?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return true;
	const subpath = specifier.slice(specifier.lastIndexOf('/'));
	return typeof e?.message === 'string' && e.message.includes(`Missing ".${subpath}" specifier`);
}

async function load(importer: Importer, specifier: string, plugin: string) {
	try {
		return await importer(specifier);
	} catch (error) {
		if (notExported(error, specifier)) return undefined;
		throw new Error(
			`@xcwds/testing couldn't import "${specifier}" for the plugin "${plugin}". If it is installed, pass \`import: (id) => import(id)\` from your test file so it resolves from there.`,
			{ cause: error }
		);
	}
}

/** Named after its package when it has no name, as the integration does. */
function named(plugin: Plugin<never>, name: string): Plugin<never> {
	const meta = pluginMeta(plugin);
	return meta.name
		? plugin
		: definePlugin((app, options) => plugin(app, options), { ...meta, name });
}

/** Resolves a test's plugins for one environment, running build entries for their routes. */
export async function prepare(
	input: TestInput,
	entry: Entry,
	{ importer = defaultImporter, logLevel }: { importer?: Importer; logLevel?: LogLevel }
): Promise<Prepared> {
	const config = 'brand' in input ? resolveConfig(input) : undefined;
	const list: TestPlugin[] = config ? config.plugins : (input.plugins ?? []);
	const builder = createApp({ storage: memoryStorage(), logLevel });
	const routes = decorateRoutes(builder);
	const plugins: Prepared['plugins'] = [];
	const origins = new Set(config?.privacy.allowOrigins ?? []);
	const declare = (plugin: Plugin<never>) => {
		const network = pluginMeta(plugin).network;
		if (network) for (const origin of network.origins) origins.add(origin);
	};
	for (const item of list) {
		if (typeof item === 'function') {
			plugins.push([item, {}]);
			declare(item);
		} else if (Array.isArray(item)) {
			if (typeof item[0] !== 'function')
				throw new TypeError(
					'A [plugin, options] pair needs a plugin function first (was the plugin imported?).'
				);
			plugins.push([item[0], { ...item[1] }]);
			declare(item[0]);
		} else if (isDescriptor(item)) {
			const options = { ...(item.options as Record<string, unknown>) };
			const main = await load(importer, item.name, item.name);
			if (!main) throw new Error(`"${item.name}" has no main entry.`);
			if (typeof main.build === 'function') {
				builder.register(named(main.build as Plugin<never>, item.name), options as never);
				// The build entry declares the package's network use (#22).
				declare(main.build as Plugin<never>);
			}
			const mod = await load(importer, `${item.name}/${entry}`, item.name);
			if (mod && typeof mod.default === 'function') {
				plugins.push([mod.default as Plugin<never>, options]);
				declare(mod.default as Plugin<never>);
			}
		} else
			throw new TypeError(
				'A test plugin is a plugin function, a [plugin, options] pair or a descriptor.'
			);
	}
	await builder.ready();
	await builder.close();
	return {
		name: config?.brand.name ?? 'xcwds',
		storagePrefix: config?.storage.prefix,
		appName: config?.storage.appName,
		plugins,
		routes: routes.list(),
		origins: [...origins]
	};
}
