/**
 * Reads `xcwds.config.*`, runs the plugins' build hooks and writes `.xcwds/` (Node only). Runs
 * whenever `svelte.config.js` loads, which happens before `svelte-kit sync`, `svelte-check`,
 * `vite dev` and `vite build`, so the generated files always exist (RFC 0001, decision 3).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	XcwdsError,
	codes,
	createApp,
	createManifest,
	definePlugin,
	memoryStorage,
	pluginMeta,
	resolveConfig,
	resolveNetwork,
	type Plugin
} from '@xcwds/core';
import { decorateRoutes } from '../routes.js';
import { assetCollisions, buildModule, guardModule, workerModule } from './codegen.js';
import type { BuildState, PluginInfo } from './state.js';

export const CONFIG_FILES = [
	'xcwds.config.ts',
	'xcwds.config.mts',
	'xcwds.config.js',
	'xcwds.config.mjs'
];

/** The directory generated files go in, relative to the app's root. */
export const OUT_DIR = '.xcwds';

/**
 * Writes a generated file in one step: to a temporary file, then renamed over it. `generate`
 * can run several times at once (Vitest loads the config once per project), and a plain
 * `writeFile` empties the file before writing, so another run could import it empty (#110). The
 * temporary name is random, so runs in other processes or worker threads never share one.
 */
async function writeGenerated(file: string, content: string) {
	const temp = `${file}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, content);
		await rename(temp, file);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
}

export function findConfig(root: string): string {
	for (const name of CONFIG_FILES) {
		const file = join(root, name);
		if (existsSync(file)) return file;
	}
	throw new XcwdsError(
		codes.CONFIG_INVALID,
		`No xcwds config in ${root}: add an xcwds.config.ts that exports defineConfig({ ... }).`
	);
}

/** A plugin package's `package.json` and directory, found the way Node finds packages. */
function findPackage(root: string, name: string): { exports: unknown; dir: string } {
	for (let dir = root; ; dir = dirname(dir)) {
		const file = join(dir, 'node_modules', name, 'package.json');
		if (existsSync(file)) {
			const { exports } = JSON.parse(readFileSync(file, 'utf8')) as { exports: unknown };
			return { exports, dir: realpathSync(dirname(file)) };
		}
		if (dirname(dir) === dir) break;
	}
	throw new XcwdsError(
		codes.CONFIG_INVALID,
		`The plugin "${name}" isn't installed: add it to your app's dependencies.`,
		{ plugin: name }
	);
}

function hasExport(exports: unknown, subpath: string): boolean {
	return typeof exports === 'object' && exports !== null && subpath in exports;
}

/** A build entry's `build` export: a kernel plugin that adds build hooks and routes. */
function buildPlugin(name: string, module: Record<string, unknown>): Plugin<never> | undefined {
	const build = module.build;
	if (build === undefined) return undefined;
	if (typeof build !== 'function')
		throw new XcwdsError(
			codes.PLUGIN_NOT_A_FUNCTION,
			`The \`build\` export of "${name}" must be a plugin (definePlugin(...)).`,
			{ plugin: name }
		);
	const plugin = build as Plugin<never>;
	const meta = pluginMeta(plugin);
	// Named after its package, so errors and the route registry say whose it is.
	return meta.name
		? plugin
		: definePlugin((app, options) => plugin(app, options), { ...meta, name });
}

const isPath = (v: unknown): v is string =>
	typeof v === 'string' && v.startsWith('/') && !/[?#]/.test(v);

export type GenerateOptions = {
	/** The app's root (where `xcwds.config.*` and `package.json` are). */
	root: string;
	/** SvelteKit's `paths.base`. */
	base?: string;
	/** SvelteKit's `kit.files.assets`, relative to `root`. */
	assets?: string;
};

export async function generate({
	root,
	base = '',
	assets = 'static'
}: GenerateOptions): Promise<BuildState> {
	const configFile = findConfig(root);
	// Vite's module runner loads TypeScript configs with no separate compiler (Vite >= 6.1).
	const { runnerImport } = await import('vite');
	const { module, dependencies } = await runnerImport<{ default: unknown }>(configFile, {
		root,
		logLevel: 'error',
		// Not the app's tsconfig: it usually extends `.svelte-kit/tsconfig.json`, which a fresh
		// checkout only has once `svelte-kit sync` has run, and that sync loads this config.
		esbuild: { tsconfigRaw: '{}' }
	});
	const fileExists = (path: string) => existsSync(resolve(root, path));
	let config = resolveConfig(module.default, { fileExists });
	// Valid, so plain data: hooks get a copy of the config as written.
	const written = structuredClone(module.default) as Record<string, unknown>;

	const dir = join(root, OUT_DIR);
	await mkdir(dir, { recursive: true });
	await writeGenerated(join(dir, '.gitignore'), '*\n');

	const plugins: PluginInfo[] = config.plugins.map(({ name, options }) => {
		const { exports, dir } = findPackage(root, name);
		return {
			name,
			options,
			dir,
			client: hasExport(exports, './client'),
			worker: hasExport(exports, './worker'),
			network: false
		};
	});

	// Plugins' `.` entries, imported from the app's root as the config imported them.
	const buildFile = join(dir, 'build.js');
	await writeGenerated(buildFile, buildModule(plugins.map((p) => p.name)));
	const entries = (await import(`${pathToFileURL(buildFile).href}?t=${Date.now()}`)) as {
		default: Record<string, unknown>[];
	};

	const app = createApp({ storage: memoryStorage(), appName: config.storage.appName });
	const routes = decorateRoutes(app);
	plugins.forEach((p, i) => {
		const plugin = buildPlugin(p.name, entries.default[i]!);
		if (!plugin) return;
		// The build entry declares the package's network use (#22), perhaps from its options (#103).
		const { prefix: _prefix, ...options } = p.options;
		p.network = resolveNetwork(pluginMeta(plugin).network, options, p.name);
		app.register(plugin, { ...p.options } as never);
	});
	await app.ready();

	// `onConfig` may change the config, but not its plugins: they have loaded already.
	const next = resolveConfig(await app.hooks.reduce('onConfig', written), { fileExists });
	if (JSON.stringify(next.plugins) !== JSON.stringify(config.plugins))
		throw new XcwdsError(codes.CONFIG_INVALID, "onConfig hooks can't add or remove plugins.");
	config = next;

	const head = (await app.hooks.collect('onHead', [])).filter((s) => typeof s === 'string');
	const worker = (await app.hooks.collect('onWorker', [])).flat();
	const prerender = (await app.hooks.collect('onPrerender', [])).flat();
	for (const path of prerender)
		if (!isPath(path))
			throw new XcwdsError(
				codes.CONFIG_INVALID,
				`onPrerender returned ${JSON.stringify(path)}; paths start with "/" and have no query or hash.`
			);
	const manifest = {
		...(await app.hooks.reduce('onManifest', createManifest(config, { base }))),
		...config.manifest
	};
	await app.close();

	const state: BuildState = {
		root,
		base,
		assetsDir: resolve(root, assets),
		configFile,
		dependencies,
		config,
		plugins,
		head,
		worker,
		prerender,
		routes: routes.list(),
		manifest
	};
	const clashes = assetCollisions(state);
	if (clashes.length) {
		const dir = relative(root, state.assetsDir) || '.';
		const icon = config.brand.icon && resolve(root, config.brand.icon);
		const source = clashes.find((file) => resolve(state.assetsDir, file) === icon);
		throw new XcwdsError(
			codes.CONFIG_INVALID,
			source
				? `brand.icon is ${config.brand.icon}, where @xcwds/sveltekit writes the icon it generates. Move the source SVG out of ${dir}/ (e.g. to the app's root) and point brand.icon at it.`
				: `@xcwds/sveltekit generates ${clashes.join(', ')}, which your static files also have. Remove ${clashes.length === 1 ? 'it' : 'them'} from ${dir}/ (set brand.icon and manifest in the xcwds config instead).`
		);
	}
	await writeGenerated(join(dir, 'worker-guard.js'), guardModule(state));
	await writeGenerated(join(dir, 'worker.js'), workerModule(state));
	return state;
}
