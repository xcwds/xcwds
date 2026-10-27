/**
 * The page entry: hands the app the scanner as `app.scanner`, with the scan in progress kept in the
 * app's blob store (`app:scanner:pages`, or the `collection` option's key: personal, so a lock's
 * reset clears it, and out of backups), and looks after it whatever page is showing:
 *
 * - **Making a page.** `scan(photo, corners)` straightens, filters and encodes the page in the
 *   processing Worker, then adds it to the scan (or replaces a page, with `retake`).
 * - **Updates wait.** From the tap until the page is saved, an `onBeforeReload` reason holds app
 *   updates back, so an update never drops a page halfway.
 * - **Closing.** `onClose` stops the Worker.
 *
 * Imported at prerender too, so it only touches browser globals when a method is called.
 */
import { definePlugin } from '@xcwds/core';
import type { EncodeOptions } from './encode.js';
import type { Paper, Quad } from './geometry.js';
import { CORE, NAME, resolveOptions, type ScannerPluginOptions } from './options.js';
import { createPages, type Pages, type PagesEnv } from './pages.js';
import { createProcessor, type ProcessOptions, type ProcessorOptions } from './process.js';
import type { Pixels } from './warp.js';

export type { Filter } from './filters.js';
export type { Paper, Point, Quad } from './geometry.js';
export type { PageResult, Pages, ScanPage } from './pages.js';
export type { Pixels } from './warp.js';

export interface ScanOptions extends ProcessOptions, EncodeOptions {
	/** Replaces this page's image, keeping its place, instead of adding a page at the end. */
	retake?: string;
}

/** The page's id, and the paper size its shape was snapped to, if any. */
export type ScanResult =
	{ ok: true; id: string; paper: Paper | null } | { ok: false; error: string };

/** `app.scanner`. */
export interface Scanner {
	/** The scan in progress: its pages, kept between visits. */
	readonly pages: Pages;
	/** True from a `scan` call until its page is saved (or failed). */
	readonly busy: boolean;
	/**
	 * Makes the finished page from a photo and the page's corners (clockwise from the top left, in
	 * the photo's pixels) and saves it. `photo` is copied, so it stays usable for another crop.
	 * Resolves with an error to show when the browser can't make a JPEG of the page or the page
	 * can't be saved. Rejects with a `RangeError` for a request that can't be met (corners that
	 * don't make a page, an unknown filter, a bad `max` or `quality`): check `isConvex` first.
	 */
	scan(photo: Pixels, corners: Quad, options?: ScanOptions): Promise<ScanResult>;
	/** Calls `listener` when `busy` changes. */
	onChange(listener: () => void): () => void;
}

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-scanner`. */
		readonly scanner?: Scanner;
	}
}

/** The browser APIs the plugin uses; the real ones unless a test passes its own. */
export type ScannerPluginEnv = {
	pages?: PagesEnv;
	processor?: ProcessorOptions;
};

/**
 * What a reload would interrupt. A noun phrase, as plugin-update's banner says "Reloading now will
 * interrupt your {busy}".
 */
export const SCANNING = 'page being scanned';

/**
 * Makes the plugin with the browser APIs in `env` (tests pass stand-ins); the default export uses
 * the real ones.
 */
export function scannerPlugin(env: ScannerPluginEnv = {}) {
	return definePlugin(
		(app, input: ScannerPluginOptions) => {
			const { collection } = resolveOptions(input);
			const pages = createPages(
				app.blobs,
				collection === undefined ? {} : { key: collection },
				env.pages
			);
			const processor = createProcessor(env.processor);

			let running = 0;
			const listeners = new Set<() => void>();
			const busy = (change: 1 | -1) => {
				const was = running > 0;
				running += change;
				if (was !== running > 0) for (const listener of [...listeners]) listener();
			};

			const scanner: Scanner = {
				pages,
				get busy() {
					return running > 0;
				},
				async scan(photo, corners, { retake, ...options } = {}) {
					busy(1);
					try {
						let page;
						try {
							page = await processor.finish(photo, corners, options);
						} catch (e) {
							if (e instanceof RangeError) throw e;
							return { ok: false, error: (e as Error).message };
						}
						const { paper, ...input } = page;
						const saved =
							retake === undefined ? await pages.add(input) : await pages.retake(retake, input);
						return saved.ok ? { ok: true, id: saved.id, paper } : saved;
					} finally {
						busy(-1);
					}
				},
				onChange(listener) {
					listeners.add(listener);
					return () => void listeners.delete(listener);
				}
			};
			app.decorate('scanner', scanner);

			app.addHook('onBeforeReload', () => (scanner.busy ? SCANNING : undefined));
			app.addHook('onClose', () => processor.close());
		},
		{ name: NAME, core: CORE, encapsulate: false, network: false }
	);
}

export default scannerPlugin();
