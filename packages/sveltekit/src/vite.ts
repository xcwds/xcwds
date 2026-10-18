/**
 * `@xcwds/sveltekit/vite`: the Vite plugin, which adds SvelteKit's own. Pass it the SvelteKit
 * config you would give `sveltekit()`:
 *
 *   export default defineConfig({ plugins: [xcwds({ paths: { base: '/repo' } })] });
 *
 * It reads `xcwds.config.*` (writing `.xcwds/`) before SvelteKit's plugin is created, sets the
 * adapter, prerender entries and CSP (see `kitConfig`), serves `virtual:xcwds/client` (each
 * plugin's `./client` entry, routes and head data) to the page bundle, and emits
 * `manifest.webmanifest` and the icons. The root layout still needs `export const prerender = true`.
 */
import { resolve } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Config } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { generate } from './build/generate.js';
import { kitConfig, type AdapterOptions } from './build/kit.js';
import { plugin } from './build/plugin.js';

export type XcwdsOptions = {
	/** The app's root. Defaults to the working directory, where Vite looks for its config. */
	root?: string;
	/** Options for adapter-static (ignored when the SvelteKit config sets `adapter`). */
	adapter?: AdapterOptions;
};

/**
 * The xcwds plugin followed by SvelteKit's. `config` is SvelteKit's (what `sveltekit()` takes);
 * xcwds adds the adapter, prerender entries and CSP to it.
 */
export async function xcwds(config: Config = {}, options: XcwdsOptions = {}): Promise<Plugin[]> {
	const state = await generate({
		root: resolve(options.root ?? process.cwd()),
		base: config.paths?.base ?? '',
		assets: config.files?.assets ?? 'static'
	});
	return [plugin(state), ...(await sveltekit(kitConfig(config, state, options.adapter)))];
}
