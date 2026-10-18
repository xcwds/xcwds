import type { NetworkUse, ResolvedConfig } from '@xcwds/core';
import type { RouteInfo } from '../routes.js';

/** A plugin from the config, with the entries its package exports. */
export type PluginInfo = {
	name: string;
	options: Record<string, unknown>;
	/** The package's directory (symlinks resolved). */
	dir: string;
	/** What its build entry's metadata declares (`false` without a build entry). */
	network: NetworkUse;
	/** Whether the package exports `./client` (the page) and `./worker` (the service worker). */
	client: boolean;
	worker: boolean;
};

/** Everything the build learnt from `xcwds.config.*` and the plugins' build hooks. */
export type BuildState = {
	root: string;
	/** SvelteKit's `paths.base`. */
	base: string;
	/** SvelteKit's static files directory (`files.assets`), absolute. */
	assetsDir: string;
	configFile: string;
	/** Files the config imports (watched by `vite dev`). */
	dependencies: string[];
	config: ResolvedConfig;
	plugins: PluginInfo[];
	/** `onHead` snippets. */
	head: string[];
	/** `onWorker` module specifiers. */
	worker: string[];
	/** `onPrerender` paths. */
	prerender: string[];
	routes: RouteInfo[];
	/** The Web App Manifest, after `onManifest` hooks and `config.manifest`. */
	manifest: Record<string, unknown>;
};
