/**
 * The page entry. Adds a Share button to the shell's header once the app boots (shown in the
 * installed app, which has no browser toolbar to share from) and, with a `target`, `app.shared`, which hands the
 * target page what another app shared.
 *
 * Imported at prerender too, so it only touches browser globals when called in the browser.
 */
import { definePlugin, type BlobScope, type Collection } from '@xcwds/core';
import type {} from '@xcwds/plugin-shell/client';
import type { Component } from 'svelte';
import {
	CORE,
	INBOX,
	INBOX_MAX_AGE,
	NAME,
	filesFromFragment,
	fromFragment,
	fromQuery,
	resolveOptions,
	type InboxMeta,
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
	/** The target page (an app path); with `files` only, `files.target`. */
	readonly target: string;
	/** The page that receives shared images, with `files`; otherwise null. */
	readonly filesTarget: string | null;
	/**
	 * Calls `listener` with what was shared, now and whenever another share arrives (Safari may
	 * reuse an open tab and only change the hash), and clears it from the address bar and
	 * history. Shared images come as `files`, taken out of the inbox as they're handed over.
	 * Call it from the target page's `onMount`; returns a function that stops it.
	 */
	listen(listener: (shared: Shared) => void): () => void;
};

/** What this plugin uses of `app.settingsPage` (from `@xcwds/plugin-settings`, if present). */
type SettingsPageLike = {
	add(component: Component, options?: { order?: number; in?: 'privacy' }): () => void;
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

/**
 * Takes shared files out of the inbox: each one read is deleted, so the inbox holds nothing once
 * the page has them. One that can't be read (gone, or sealed while the app is locked) is left
 * for the day-old clean-up and counted as skipped.
 */
export async function takeFiles(
	blobs: Pick<BlobScope, 'get' | 'delete'>,
	inbox: Collection<InboxMeta>,
	ids: readonly string[]
): Promise<{ files: File[]; missing: number }> {
	const files: File[] = [];
	let missing = 0;
	for (const id of ids) {
		const saved = await blobs.get(inbox, id);
		if (!saved) {
			missing++;
			continue;
		}
		const { blob, meta } = saved;
		files.push(new File([blob], meta?.name || 'shared', { type: blob.type }));
		await blobs.delete(inbox, id);
	}
	return { files, missing };
}

/** Deletes inbox files older than a day: shares no page took. */
export async function cleanInbox(
	blobs: Pick<BlobScope, 'list' | 'delete'>,
	inbox: Collection<InboxMeta>,
	now = Date.now()
): Promise<void> {
	for (const info of await blobs.list(inbox))
		if (now - info.created > INBOX_MAX_AGE) await blobs.delete(inbox, info.id);
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

		const { files } = options;
		const inbox = files ? app.blobs.register(INBOX) : null;
		const target = options.target ?? files?.target;
		if (target)
			app.decorate('shared', {
				target,
				filesTarget: files?.target ?? null,
				listen(listener) {
					let stopped = false;
					const receive = () => {
						const url = new URL(location.href);
						const shared = readShared(url);
						if (!shared) return;
						const ids = filesFromFragment(url.hash)?.ids ?? [];
						// Don't leave it in the address bar or browser history.
						history.replaceState(history.state, '', location.pathname);
						if (!ids.length || !inbox) return listener(shared);
						void takeFiles(app.blobs, inbox, ids).then(({ files, missing }) => {
							if (stopped) return;
							const skipped = (shared.skipped ?? 0) + missing;
							listener({ ...shared, files, ...(skipped ? { skipped } : {}) });
						});
					};
					receive();
					addEventListener('hashchange', receive);
					return () => {
						stopped = true;
						removeEventListener('hashchange', receive);
					};
				}
			} satisfies AppShared);

		// Beside the page title (the shell must be registered first). Loaded once the app boots: the
		// button only shows in the installed app, which prerendered HTML can't know, and a static
		// import would make this entry and @xcwds/sveltekit import each other.
		let remove: (() => void) | undefined;
		let closed = false;
		const stops: (() => void)[] = [];
		app.addHook('onBoot', async () => {
			if (inbox) {
				void cleanInbox(app.blobs, inbox);
				// With @xcwds/plugin-settings, Settings → Privacy says when a shared image can reach the
				// server. Loaded lazily: the component imports @xcwds/sveltekit, which imports this entry.
				const page = (app as { settingsPage?: SettingsPageLike }).settingsPage;
				if (page)
					void import('./FilesNote.svelte').then(({ default: FilesNote }) => {
						if (!closed) stops.push(page.add(FilesNote, { in: 'privacy' }));
					});
			}
			if (!app.shell) return;
			const { default: ShareButton } = await import('./ShareButton.svelte');
			if (!closed) remove = app.shell.header.add(ShareButton, { order: 100 });
		});
		app.addHook('onClose', () => {
			closed = true;
			remove?.();
			for (const stop of stops.splice(0)) stop();
		});
	},
	{ name: NAME, core: CORE, encapsulate: false, network: false }
);
