/**
 * `@xcwds/plugin-vault`: the config factory and build entry (RFC 0001, decision 1). Keeps the
 * app's sensitive storage groups encrypted with the passcode of `@xcwds/plugin-lock` (#79), which
 * must come before it in `plugins`.
 *
 * ```ts
 * import lock from '@xcwds/plugin-lock';
 * import vault from '@xcwds/plugin-vault';
 * export default defineConfig({ brand, plugins: [lock(), vault()] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, LOCK, NAME, resolveOptions, type VaultPluginOptions } from './options.js';

export type { VaultPluginOptions } from './options.js';

export default descriptor<VaultPluginOptions>(NAME);

/** Checks the options and that the lock comes first, so a mistake fails the build, not the page. */
export const build = definePlugin(
	(_app, options: VaultPluginOptions) => void resolveOptions(options),
	{ name: NAME, core: CORE, dependencies: [LOCK], network: false }
);
