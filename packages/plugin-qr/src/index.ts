/**
 * `@xcwds/plugin-qr`: the config factory and build entry (RFC 0001, decision 1). It declares that
 * the plugin talks to no server; `<QrCode>`, `<QrScanner>`, `qrSvg()` and `scan()` do the work.
 *
 * ```ts
 * import qr from '@xcwds/plugin-qr';
 * export default defineConfig({ brand, plugins: [camera(), qr()] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type QrPluginOptions } from './options.js';

export type { QrPluginOptions } from './options.js';

export default descriptor<QrPluginOptions>(NAME);

/** Checks the options when the config loads, so a mistake fails the build, not the page. */
export const build = definePlugin(
	(_app, options: QrPluginOptions) => void resolveOptions(options),
	{ name: NAME, core: CORE, network: false }
);
