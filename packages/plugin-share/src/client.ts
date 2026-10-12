/**
 * The page entry. Adds a Share button to the shell's header once the app boots (shown in the
 * installed app, which has no browser toolbar to share from) and, with a `target`, `app.shared`, which hands the
 * target page what another app shared.
 *
 * Imported at prerender too, so it only touches browser globals when called in the browser.
 */
import { definePlugin } from '@xcwds/core';
import type {} from '@xcwds/plugin-shell/client';
import {
	CORE,
	NAME,
	fromFragment,
	fromQuery,
	resolveOptions,
	type ShareOptions,
	type Shared
} from './options.js';
import { share, type ShareData, type ShareResult } from './share.js';

/** `app.share`. */
export type AppShare = {
	/** Paths (and everything under them) that never show the Share button. */
	readonly exclude: readonly string[];
	/** Shares `data` (or copies its link), and says so with a toast when it copied or failed. */
	share(data: ShareData): Promise<ShareResult>;
};

/** `app.shared`, with a `target`. */
export type AppShared = {
	/** The target page (an app path). */
	readonly target: string;
	/**
	 * Calls `listener` with what was shared, now and whenever another share arrives (Safari may
	 * reuse an open tab and only change the hash), and clears it from the address bar and
	 * history. Call it from the target page's `onMount`; returns a function that stops it.
	 */
	listen(listener: (shared: Shared) => void): () => void;
};

declare module '@xcwds/core' {
	interface App {
		/** From `@xcwds/plugin-share`. */
		readonly share?: AppShare;
		/** From `@xcwds/plugin-share`, when it has a `target`. */
		readonly shared?: AppShared;
	}
}

/** What the address holds: a fragment from the worker or the Shortcut, else the raw query. */
export function readShared(location: URL): Shared | null {
	// The query is the fallback for a share that arrived before the worker controlled the page
	// (Android may open the target cold right after install): it did reach the server once.
	return fromFragment(location.hash) ?? fromQuery(location.searchParams);
}

export default definePlugin(
	(app, input: ShareOptions) => {
		const options = resolveOptions(input);
		app.decorate('share', {
			exclude: options.exclude,
			async share(data) {
				const result = await share(data);
				if (result === 'copied') app.toast?.('Link copied.');
				if (result === 'failed') app.toast?.("Couldn't share or copy the link.");
				return result;
			}
		} satisfies AppShare);

		if (options.target)
			app.decorate('shared', {
				target: options.target,
				listen(listener) {
					const receive = () => {
						const shared = readShared(new URL(location.href));
						if (!shared) return;
						// Don't leave it in the address bar or browser history.
						history.replaceState(history.state, '', location.pathname);
						listener(shared);
					};
					receive();
					addEventListener('hashchange', receive);
					return () => removeEventListener('hashchange', receive);
				}
			} satisfies AppShared);

		// Beside the page title (the shell must be registered first). Loaded once the app boots: the
		// button only shows in the installed app, which prerendered HTML can't know, and a static
		// import would make this entry and @xcwds/sveltekit import each other.
		let remove: (() => void) | undefined;
		let closed = false;
		app.addHook('onBoot', async () => {
			if (!app.shell) return;
			const { default: ShareButton } = await import('./ShareButton.svelte');
			if (!closed) remove = app.shell.header.add(ShareButton, { order: 100 });
		});
		app.addHook('onClose', () => {
			closed = true;
			remove?.();
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
