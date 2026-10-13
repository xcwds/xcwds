import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Rollup } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withXcwds } from '../config.js';
import { xcwds } from '../vite.js';
import { clientModule, guardModule } from './codegen.js';
import { generate } from './generate.js';
import { recall } from './state.js';

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

describe('withXcwds', () => {
	it('sets the adapter, prerender entries and a hash-mode CSP, and remembers the build', async () => {
		const config = await withXcwds(
			{
				kit: {
					paths: { base: '/sub' },
					prerender: { entries: ['*', '/more'] },
					csp: {
						directives: {
							'img-src': ['https://img.example'],
							'upgrade-insecure-requests': true
						}
					}
				}
			},
			{ root }
		);
		expect(config.kit?.adapter?.name).toBe('@sveltejs/adapter-static');
		expect(config.kit?.prerender?.entries).toEqual([
			'*',
			'/more',
			'/utils/timer',
			'/utils/timer/extra'
		]);
		expect(config.kit?.csp?.mode).toBe('hash');
		expect(config.kit?.csp?.directives?.['img-src']).toEqual([
			'self',
			'data:',
			'blob:',
			'https://img.example'
		]);
		expect(config.kit?.csp?.directives?.['script-src']).toEqual(['self']);
		expect(config.kit?.csp?.directives?.['upgrade-insecure-requests']).toBe(true);
		expect(recall(root)?.base).toBe('/sub');
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
		const config = await withXcwds({}, { root });
		const directives = config.kit!.csp!.directives!;
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
		expect(recall(root)?.plugins.map((p) => p.network)).toEqual([
			{
				origins: ['https://api.weather.example', 'wss://live.weather.example'],
				reason: 'Forecasts'
			},
			false
		]);
		expect(clientModule(recall(root)!)).toContain(
			'"privacy":{"plugins":[{"name":"weather","network":{"origins":["https://api.weather.example","wss://live.weather.example"],"reason":"Forecasts"}},{"name":"plain","network":false}],"allowOrigins":["https://fonts.example"]}'
		);

		// The adapter scans SvelteKit's output before writing the site.
		const out = join(root, '.svelte-kit');
		let adapted = false;
		const builder = {
			getClientDirectory: () => join(out, 'output/client'),
			getBuildDirectory: (name: string) => join(out, name)
		};
		const adapter = (
			await withXcwds(
				{ kit: { adapter: { name: 'mine', adapt: () => void (adapted = true) } } },
				{ root }
			)
		).kit!.adapter!;
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
		const config = await withXcwds({}, { root });
		expect(config.kit!.csp!.directives!['connect-src']).toEqual(['self', 'https://relay.example']);
		expect(recall(root)?.plugins.map((p) => p.network)).toEqual([
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

describe('the Vite plugin', () => {
	it('serves the client module and emits the manifest in the client build only', async () => {
		await withXcwds({}, { root });
		const plugin = xcwds();
		const hook = <T>(h: unknown): T =>
			(typeof h === 'function' ? h : (h as { handler: unknown }).handler) as T;
		expect(hook<() => unknown>(plugin.config).call({})).toMatchObject({
			ssr: { noExternal: ['@xcwds/sveltekit'] }
		});
		const resolved = (ssr: boolean) =>
			({ root, command: 'build', build: { ssr } }) as unknown as Parameters<
				Extract<typeof plugin.configResolved, (...a: never[]) => unknown>
			>[0];
		hook<(c: unknown) => void>(plugin.configResolved)(resolved(true));
		const id = hook<(id: string) => string>(plugin.resolveId).call({}, 'virtual:xcwds/client');
		expect(hook<(id: string) => string>(plugin.load).call({}, id)).toContain(
			'xcwds-plugin-timers/client'
		);

		const emitted: Rollup.EmittedAsset[] = [];
		const context = {
			emitFile: (f: Rollup.EmittedAsset) => emitted.push(f),
			error: (message: string) => {
				throw new Error(message);
			}
		};
		const generateBundle = hook<(this: typeof context) => Promise<void>>(plugin.generateBundle);
		await generateBundle.call(context);
		expect(emitted).toEqual([]);
		hook<(c: unknown) => void>(plugin.configResolved)(resolved(false));
		await generateBundle.call(context);
		expect(emitted.map((f) => f.fileName)).toEqual(['manifest.webmanifest']);
		expect(JSON.parse(String(emitted[0]!.source))).toMatchObject({ name: 'Test' });
		// A static file added after svelte.config.js loaded still fails the build.
		await write('static/manifest.webmanifest', '{}');
		await expect(generateBundle.call(context)).rejects.toThrow('generates manifest.webmanifest');
	});

	it('asks for withXcwds() when svelte.config.js has not run it', () => {
		const plugin = xcwds();
		const configResolved = plugin.configResolved as (c: unknown) => void;
		expect(() => configResolved({ root: join(root, 'other') })).toThrow('withXcwds()');
		expect(existsSync(join(root, 'other'))).toBe(false);
	});
});
