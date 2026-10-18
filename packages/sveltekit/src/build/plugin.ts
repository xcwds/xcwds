/** The xcwds Vite plugin itself, serving what `generate` found. */
import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { stripBase } from '../routes.js';
import { buildAssets, contentType } from './assets.js';
import { assetCollisions, clientModule, prebundled } from './codegen.js';
import type { BuildState } from './state.js';

const CLIENT = 'virtual:xcwds/client';
const RESOLVED = `\0${CLIENT}`;
const PACKAGE = '@xcwds/sveltekit';

export function plugin(state: BuildState): Plugin {
	let vite: ResolvedConfig;
	let assets: Promise<Map<string, string | Uint8Array>> | null = null;
	const getAssets = () => (assets ??= buildAssets(state));

	return {
		name: 'xcwds',
		config: () => ({
			// The package imports `virtual:xcwds/client`, so Vite must process it rather than leave
			// it to Node (SSR) or pre-bundle it (dev).
			ssr: { noExternal: [PACKAGE] },
			optimizeDeps: {
				exclude: [PACKAGE],
				// The plugins' page entries, which its dependency scan can't see (see `prebundled`).
				include: prebundled(state.plugins, state.root)
			}
		}),
		configResolved(config) {
			vite = config;
		},
		resolveId: (id) => (id === CLIENT ? RESOLVED : undefined),
		load(id) {
			if (id === RESOLVED) return clientModule(state);
			return undefined;
		},
		async generateBundle() {
			// SvelteKit builds the server first, then the client; the files belong to the client.
			if (vite.command !== 'build' || this.environment.name !== 'client') return;
			// generate() refuses these already; checked again in case a file appeared since.
			const clashes = assetCollisions(state);
			if (clashes.length)
				this.error(
					`@xcwds/sveltekit generates ${clashes.join(', ')}; remove them from your static files.`
				);
			for (const [fileName, source] of await getAssets())
				this.emitFile({ type: 'asset', fileName, source });
		},
		configureServer(server) {
			// A changed config changes generated code: restart, which reloads vite.config.ts.
			const watched = new Set([state.configFile, ...state.dependencies].map((f) => resolve(f)));
			server.watcher.add([...watched]);
			server.watcher.on('change', (file) => {
				if (watched.has(resolve(file))) void server.restart();
			});
			// `vite dev` has no build output: serve the manifest and icons from memory.
			server.middlewares.use((req, res, next) => {
				const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
				const path = stripBase(pathname, state.base);
				if (path === null) return next();
				getAssets().then((files) => {
					const body = files.get(path.slice(1));
					if (body === undefined) return next();
					res.setHeader('content-type', contentType(path));
					res.end(body);
				}, next);
			});
		}
	};
}
