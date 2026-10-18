import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Rollup } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '@sveltejs/kit/vite';
import { xcwds } from '../vite.js';
import { clientModule, guardModule, prebundled } from './codegen.js';
import { generate, withConfigManifest } from './generate.js';
import { kitConfig } from './kit.js';
import { plugin as vitePlugin } from './plugin.js';
import type { PluginInfo } from './state.js';

let root: string;

async function write(file: string, content: string) {
	await mkdir(dirname(join(root, file)), { recursive: true });
	await writeFile(join(root, file), content);
}

/** A plugin package in the app's node_modules, with a build entry using every build hook. */
async function plugin(name: string, exports: Record<string, string>, index: string) {
	await write(
		`node_modules/${name}/package.json`,
		JSON.stringify({ name, type: 'module', exports })
	);
	await write(`node_modules/${name}/index.js`, index);
}

const BUILD = `
export const build = (app, options) => {
	app.route({ path: '/', title: 'Timer', parent: '/' });
	app.addHook('onConfig', (config) => ({ ...config, brand: { ...config.brand, shortName: 'Short' } }));
	app.addHook('onHead', () => 'document.documentElement.dataset.x=' + JSON.stringify(options.x) + ';');
	app.addHook('onWorker', () => ['side-effect']);
	app.addHook('onPrerender', () => ['/utils/timer/extra']);
	app.addHook('onManifest', (m) => ({ ...m, categories: ['utilities'] }));
};
`;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'xcwds-sveltekit-'));
	await plugin(
		'xcwds-plugin-timers',
		{ '.': './index.js', './client': './client.js', './worker': './worker.js' },
		BUILD
	);
	await plugin('plain', { '.': './index.js' }, 'export default {};');
	await write(
		'xcwds.config.ts',
		`const name: string = 'Test';
export default {
	brand: { name },
	manifest: { display: 'minimal-ui' },
	plugins: [{ name: 'xcwds-plugin-timers', options: { x: 1, prefix: '/utils/timer' } }, { name: 'plain', options: {} }]
};`
	);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('withConfigManifest', () => {
	const tool = { name: 'Timer', url: '/timer' };
	const recipes = { name: 'Recipes', url: '/recipes' };

	it("lets the config's fields win, but adds the hooks' shortcuts after its own (#132)", () => {
		// What `onManifest` hooks return: createManifest already put the config's shortcuts first.
		const hooked = { display: 'standalone', shortcuts: [recipes, tool] };
		expect(withConfigManifest(hooked, { display: 'minimal-ui', shortcuts: [recipes] })).toEqual({
			display: 'minimal-ui',
			shortcuts: [recipes, tool]
		});
	});

	it("keeps the hooks' shortcuts when the config has none, and the config's when hooks add none", () => {
		expect(withConfigManifest({ shortcuts: [tool] }, {})).toEqual({ shortcuts: [tool] });
		expect(withConfigManifest({}, { shortcuts: [recipes] })).toEqual({ shortcuts: [recipes] });
		expect(withConfigManifest({ shortcuts: [tool] }, undefined)).toEqual({ shortcuts: [tool] });
	});

	it("drops a hook's shortcut to a page the config already has one for", () => {
		const mine = { name: 'My timer', url: '/timer' };
		expect(withConfigManifest({ shortcuts: [mine, tool] }, { shortcuts: [mine] })).toEqual({
			shortcuts: [mine]
		});
	});
});

describe('generate', () => {
	it('loads the config in a fresh checkout, before `svelte-kit sync` writes the tsconfig it extends', async () => {
		await write('tsconfig.json', JSON.stringify({ extends: './.svelte-kit/tsconfig.json' }));
		const state = await generate({ root });
		expect(state.config.brand.name).toBe('Test');
	});

	it('loads a TypeScript config, runs build hooks and writes the worker module', async () => {
		const state = await generate({ root, base: '/sub' });
		expect(state.config.brand.shortName).toBe('Short');
		expect(state.plugins).toEqual([
			{
				name: 'xcwds-plugin-timers',
				options: { x: 1, prefix: '/utils/timer' },
				dir: realpathSync(join(root, 'node_modules/xcwds-plugin-timers')),
				client: true,
				worker: true,
				network: false
			},
			{
				name: 'plain',
				options: {},
				dir: realpathSync(join(root, 'node_modules/plain')),
				client: false,
				worker: false,
				network: false
			}
		]);
		expect(state.routes).toEqual([
			{ path: '/utils/timer', title: 'Timer', parent: '/', plugin: 'xcwds-plugin-timers' }
		]);
		expect(state.head).toEqual(['document.documentElement.dataset.x=1;']);
		expect(state.worker).toEqual(['side-effect']);
		expect(state.prerender).toEqual(['/utils/timer/extra']);
		expect(state.manifest).toMatchObject({
			short_name: 'Short',
			start_url: '/sub/',
			categories: ['utilities'],
			display: 'minimal-ui'
		});

		const worker = await readFile(join(root, '.xcwds/worker.js'), 'utf8');
		expect(worker).toContain(`import p0 from "xcwds-plugin-timers/worker";`);
		expect(worker).toContain(`import "side-effect";`);
		expect(worker).not.toContain('plain/worker');
		expect(worker).toContain('"assets":["manifest.webmanifest"]');
		expect(await readFile(join(root, '.xcwds/.gitignore'), 'utf8')).toBe('*\n');
		// The network guard comes first, so it's in place before any plugin's worker code (#55).
		expect(worker.indexOf("import './worker-guard.js';")).toBeGreaterThan(-1);
		expect(worker.indexOf("import './worker-guard.js';")).toBeLessThan(worker.indexOf('import p0'));
		// What each plugin adds to the app's types, without a list in src/app.d.ts (#133).
		const types = await readFile(join(root, '.xcwds/types.d.ts'), 'utf8');
		expect(types).toContain('import type {} from "xcwds-plugin-timers/client";');
		expect(types).not.toContain('plain');
		const guard = await readFile(join(root, '.xcwds/worker-guard.js'), 'utf8');
		expect(guard).toContain(`import { guardNetwork } from '@xcwds/sveltekit/guard';`);
		expect(guard).toContain('guardNetwork(self, []);');
		expect(
			guardModule({
				...state,
				config: { ...state.config, privacy: { allowOrigins: ['https://a.example'] } },
				plugins: [
					...state.plugins,
					{
						...state.plugins[1]!,
						name: 'weather',
						network: { origins: ['https://b.example'], reason: 'Forecasts' }
					}
				]
			})
		).toContain('guardNetwork(self, ["https://b.example","https://a.example"]);');

		const client = clientModule(state);
		expect(client).toContain(`import p0 from "xcwds-plugin-timers/client";`);
		expect(client).toContain(`export const plugins = [[p0, {"x":1,"prefix":"/utils/timer"}]];`);
		expect(client).toContain('href=\\"/sub/manifest.webmanifest\\"');
	});

	it('survives several builds at once, as when Vitest loads the config for each project (#110)', async () => {
		const states = await Promise.all(Array.from({ length: 40 }, () => generate({ root })));
		for (const state of states) expect(state.routes).toHaveLength(1);
		expect(await readFile(join(root, '.xcwds/build.js'), 'utf8')).toContain('xcwds-plugin-timers');
		// No temporary files left behind.
		expect((await readdir(join(root, '.xcwds'))).sort()).toEqual([
			'.gitignore',
			'build.js',
			'config.tsconfig.json',
			'types.d.ts',
			'worker-guard.js',
			'worker.js'
		]);
	});

	it('refuses static files that collide with generated ones, naming them', async () => {
		await write('static/manifest.webmanifest', '{}');
		await write('assets/favicon.ico', '');
		await expect(generate({ root })).rejects.toThrow(
			'@xcwds/sveltekit generates manifest.webmanifest, which your static files also have. Remove it from static/'
		);
		await rm(join(root, 'static'), { recursive: true });
		await write('xcwds.config.js', `export default { brand: { name: 'T', icon: 'i.svg' } };`);
		await write('i.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
		await rm(join(root, 'xcwds.config.ts'));
		await expect(generate({ root, assets: 'assets' })).rejects.toThrow(
			'generates favicon.ico, which'
		);
		await expect(generate({ root })).resolves.toMatchObject({ assetsDir: join(root, 'static') });
		await write('static/icons/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
		await write(
			'xcwds.config.js',
			`export default { brand: { name: 'T', icon: 'static/icons/icon.svg' } };`
		);
		await expect(generate({ root })).rejects.toThrow(
			'brand.icon is static/icons/icon.svg, where @xcwds/sveltekit writes the icon it generates. Move the source SVG out of static/'
		);
	});

	it('explains a missing config, a missing plugin and options that are not JSON', async () => {
		await rm(join(root, 'xcwds.config.ts'));
		await expect(generate({ root })).rejects.toThrow('No xcwds config');
		await write(
			'xcwds.config.js',
			`export default { brand: { name: 'T' }, plugins: [{ name: 'missing', options: {} }] };`
		);
		await expect(generate({ root })).rejects.toThrow(`The plugin "missing" isn't installed`);
		await write(
			'xcwds.config.js',
			`export default { brand: { name: 'T' }, plugins: [{ name: 'plain', options: { f() {} } }] };`
		);
		await expect(generate({ root })).rejects.toThrow('plugins[0].options.f');
	});
});

/** What `xcwds()` does before creating SvelteKit's plugin. */
async function setup(config: Config = {}) {
	const state = await generate({ root, base: config.paths?.base ?? '' });
	return { config: kitConfig(config, state), state };
}

describe('kitConfig', () => {
	it('sets the adapter, prerender entries and a hash-mode CSP', async () => {
		const { config, state } = await setup({
			paths: { base: '/sub' },
			prerender: { entries: ['*', '/more'] },
			csp: {
				directives: {
					'img-src': ['https://img.example'],
					'upgrade-insecure-requests': true
				}
			}
		});
		expect(config.adapter?.name).toBe('@sveltejs/adapter-static');
		expect(config.prerender?.entries).toEqual(['*', '/more', '/utils/timer', '/utils/timer/extra']);
		expect(config.csp?.mode).toBe('hash');
		expect(config.csp?.directives?.['img-src']).toEqual([
			'self',
			'data:',
			'blob:',
			'https://img.example'
		]);
		expect(config.csp?.directives?.['script-src']).toEqual(['self']);
		expect(config.csp?.directives?.['upgrade-insecure-requests']).toBe(true);
		expect(state.base).toBe('/sub');
	});

	it('allows the origins plugins declare and the config lists, and checks the build', async () => {
		await plugin(
			'weather',
			{ '.': './index.js' },
			`export const build = () => {};
Object.defineProperty(build, Symbol.for('xcwds.plugin-meta'), {
	value: { network: { origins: ['https://api.weather.example', 'wss://live.weather.example'], reason: 'Forecasts' } }
});`
		);
		await write(
			'xcwds.config.js',
			`export default { brand: { name: 'T' }, privacy: { allowOrigins: ['https://fonts.example'] }, plugins: [{ name: 'weather', options: {} }, { name: 'plain', options: {} }] };`
		);
		await rm(join(root, 'xcwds.config.ts'));
		const { config, state } = await setup();
		const directives = config.csp!.directives!;
		expect(directives['connect-src']).toEqual([
			'self',
			'https://api.weather.example',
			'wss://live.weather.example',
			'https://fonts.example'
		]);
		// wss: only makes sense for connections; scripts only ever come from the app.
		expect(directives['font-src']).toEqual([
			'self',
			'data:',
			'https://api.weather.example',
			'https://fonts.example'
		]);
		expect(directives['script-src']).toEqual(['self']);
		expect(state.plugins.map((p) => p.network)).toEqual([
			{
				origins: ['https://api.weather.example', 'wss://live.weather.example'],
				reason: 'Forecasts'
			},
			false
		]);
		expect(clientModule(state)).toContain(
			'"privacy":{"plugins":[{"name":"weather","network":{"origins":["https://api.weather.example","wss://live.weather.example"],"reason":"Forecasts"}},{"name":"plain","network":false}],"allowOrigins":["https://fonts.example"]}'
		);

		// The adapter scans SvelteKit's output before writing the site.
		const out = join(root, '.svelte-kit');
		let adapted = false;
		const builder = {
			getClientDirectory: () => join(out, 'output/client'),
			getBuildDirectory: (name: string) => join(out, name)
		};
		const adapter = kitConfig(
			{ adapter: { name: 'mine', adapt: () => void (adapted = true) } },
			state
		).adapter!;
		expect(adapter.name).toBe('mine');
		await write('.svelte-kit/output/client/_app/a.js', 'fetch("https://api.weather.example/x")');
		await adapter.adapt(builder as never);
		expect(adapted).toBe(true);
		adapted = false;
		await write(
			'.svelte-kit/output/prerendered/pages/index.html',
			'<img src="https://pixel.example/p.gif">'
		);
		await expect(Promise.resolve().then(() => adapter.adapt(builder as never))).rejects.toThrow(
			'https://pixel.example, from the app or one of its dependencies'
		);
		expect(adapted).toBe(false);
	});

	it('resolves network use from the options the config gives the plugin', async () => {
		await plugin(
			'relay',
			{ '.': './index.js' },
			`export const build = () => {};
Object.defineProperty(build, Symbol.for('xcwds.plugin-meta'), {
	value: { network: (options) => ({ origins: [options.relay], reason: 'Syncs pages' }) }
});`
		);
		await write(
			'xcwds.config.js',
			`export default { brand: { name: 'T' }, plugins: [{ name: 'relay', options: { relay: 'https://relay.example' } }] };`
		);
		await rm(join(root, 'xcwds.config.ts'));
		const { config, state } = await setup();
		expect(config.csp!.directives!['connect-src']).toEqual(['self', 'https://relay.example']);
		expect(state.plugins.map((p) => p.network)).toEqual([
			{ origins: ['https://relay.example'], reason: 'Syncs pages' }
		]);

		await write(
			'xcwds.config.js',
			`export default { brand: { name: 'T' }, plugins: [{ name: 'relay', options: { relay: 'http://relay.example' } }] };`
		);
		await expect(generate({ root })).rejects.toThrow('Plugin "relay" has invalid `network`');
	});

	it('fails on invalid network metadata, naming the plugin', async () => {
		await plugin(
			'leaky',
			{ '.': './index.js' },
			`export const build = () => {};
Object.defineProperty(build, Symbol.for('xcwds.plugin-meta'), { value: { network: { origins: ['http://x.example'], reason: 'r' } } });`
		);
		await write(
			'xcwds.config.js',
			`export default { brand: { name: 'T' }, plugins: [{ name: 'leaky', options: {} }] };`
		);
		await rm(join(root, 'xcwds.config.ts'));
		await expect(generate({ root })).rejects.toThrow('Plugin "leaky" has invalid `network`');
	});
});

describe('prebundled', () => {
	const info = (name: string, dir: string, client = true): PluginInfo => ({
		name,
		options: {},
		dir,
		client,
		worker: false,
		network: false
	});

	it('lists installed page entries, not linked plugins or ones without a page entry (#133)', async () => {
		const plugins = [
			info('@xcwds/plugin-shell', '/app/node_modules/.pnpm/x/node_modules/@xcwds/plugin-shell'),
			info('app-plugin', '/app/src/plugins/app'),
			info('worker-only', '/app/node_modules/worker-only', false)
		];
		// @xcwds/core only when the app can resolve it (pnpm doesn't hoist peers).
		expect(prebundled(plugins, root)).toEqual(['@xcwds/plugin-shell/client']);
		await write('node_modules/@xcwds/core/package.json', '{}');
		expect(prebundled(plugins, root)).toEqual(['@xcwds/core', '@xcwds/plugin-shell/client']);
		expect(prebundled([info('app-plugin', '/app/src/plugins/app')], root)).toEqual([]);
		expect(prebundled([info('win', 'C:\\app\\node_modules\\win')], root)).toEqual([
			'@xcwds/core',
			'win/client'
		]);
	});
});

describe('the Vite plugin', () => {
	it('serves the client module and emits the manifest in the client build only', async () => {
		const plugin = vitePlugin(await generate({ root }));
		const hook = <T>(h: unknown): T =>
			(typeof h === 'function' ? h : (h as { handler: unknown }).handler) as T;
		expect(hook<(c: unknown) => unknown>(plugin.config).call({}, { root })).toEqual({
			ssr: { noExternal: ['@xcwds/sveltekit'] },
			// Installed plugins' page entries, which Vite's scan can't see (#133); not `plain`.
			optimizeDeps: {
				exclude: ['@xcwds/sveltekit'],
				include: ['xcwds-plugin-timers/client']
			}
		});
		hook<(c: unknown) => void>(plugin.configResolved)({ root, command: 'build' });
		const id = hook<(id: string) => string>(plugin.resolveId).call({}, 'virtual:xcwds/client');
		expect(hook<(id: string) => string>(plugin.load).call({}, id)).toContain(
			'xcwds-plugin-timers/client'
		);

		const emitted: Rollup.EmittedAsset[] = [];
		const context = (name: string) => ({
			environment: { name },
			emitFile: (f: Rollup.EmittedAsset) => emitted.push(f),
			error: (message: string) => {
				throw new Error(message);
			}
		});
		type Context = ReturnType<typeof context>;
		const generateBundle = hook<(this: Context) => Promise<void>>(plugin.generateBundle);
		await generateBundle.call(context('ssr'));
		await generateBundle.call(context('serviceWorker'));
		expect(emitted).toEqual([]);
		await generateBundle.call(context('client'));
		expect(emitted.map((f) => f.fileName)).toEqual(['manifest.webmanifest']);
		expect(JSON.parse(String(emitted[0]!.source))).toMatchObject({ name: 'Test' });
		// A static file added after the config loaded still fails the build.
		await write('static/manifest.webmanifest', '{}');
		await expect(generateBundle.call(context('client'))).rejects.toThrow(
			'generates manifest.webmanifest'
		);
	});

	it("comes before SvelteKit's plugins, which get the adapter and CSP", async () => {
		const plugins = await xcwds({ paths: { base: '/sub' } }, { root });
		expect(plugins[0]!.name).toBe('xcwds');
		const setup = plugins.find((p) => p.name === 'vite-plugin-sveltekit-setup');
		const options = (setup?.api as { options: Config }).options;
		expect(options.adapter?.name).toBe('@sveltejs/adapter-static');
		expect(options.csp?.mode).toBe('hash');
		expect(options.paths?.base).toBe('/sub');
		expect(existsSync(join(root, '.xcwds', 'worker.js'))).toBe(true);
	});
});
