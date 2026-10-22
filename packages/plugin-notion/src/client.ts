/**
 * The page entry (#106): saves the connection, the sources and their copies, and hands pages
 * `app.notion` to connect, choose sources and download them.
 *
 * - **Saved data** (namespace `notion`): the token (`app:notion:token`, its own group "Notion
 *   connection", personal and never in backups), the sources (`app:notion:sources`, in backups)
 *   and the latest copy of each (`app:notion:copies`, personal and out of backups, since it can
 *   be downloaded again). Copies stay within `COPY_LIMIT` and `TOTAL_LIMIT`.
 * - **Refreshing:** a page calls `refresh(id)` when it shows a source; the app coming back to the
 *   foreground (`onVisible`) refreshes every source whose copy is older than the
 *   `notionRefreshMinutes` setting (30 by default; 0 = only by hand). Going to the background
 *   (`onHidden`) cancels downloads in flight, and copies already saved stay.
 * - **Updates wait** while a download runs (`onBeforeReload`).
 *
 * The token never goes into a URL, an error message or a status. Imported at prerender too, so
 * it only reaches browser globals once a download runs.
 */
import { definePlugin, type Entry } from '@xcwds/core';
import { NotionError, createNotionClient, type NotionErrorKind } from './api.js';
import type { NotionDocument } from './document.js';
import { CORE, NAME, REASON, resolveOptions, type NotionPluginOptions } from './options.js';
import { download, fitCopy, parseCopies, parseSources, type Source } from './sources.js';

export type { NotionDocument } from './document.js';
export type { Source } from './sources.js';

/** Why a source's last download didn't give a new copy. */
export type SourceError = NotionErrorKind | 'not-connected' | 'too-large' | 'full' | 'not-saved';

/** Where a source's download stands (kept in memory, not saved). */
export type SourceStatus = {
	downloading: boolean;
	/** The last download failed: why, and a message safe to show. The saved copy stays. */
	error?: SourceError;
	message?: string;
	/** A "newest" source found no page at all on its last download. */
	empty?: boolean;
};

/** `app.notion`. */
export type AppNotion = {
	/** The relay's origin and the sources page's path, from the options. */
	readonly relay: string;
	readonly page: string;
	/** Whether a token is saved. */
	connected(): boolean;
	/**
	 * Checks `token` with Notion and saves it if Notion accepts it: the integration's name, or why
	 * not. Nothing is saved on failure.
	 */
	connect(
		token: string
	): Promise<{ ok: true; name: string } | { ok: false; error: SourceError; message: string }>;
	/** Removes the token and every saved copy (the sources stay). */
	disconnect(): void;
	/** The saved sources, in order. */
	sources(): Source[];
	/** Saves the sources (from the latest saved list); copies of removed ones go too. */
	saveSources(change: (sources: Source[]) => Source[]): boolean;
	/** A source's saved copy. */
	copy(id: string): NotionDocument | undefined;
	status(id: string): SourceStatus;
	/** Whether a source's copy is older than the refresh setting (or missing). */
	stale(id: string): boolean;
	/** Downloads a source again (only if `stale`, unless `force`); its status afterwards. */
	refresh(id: string, options?: { force?: boolean }): Promise<SourceStatus>;
	/** Called when sources, copies, statuses or the connection change. */
	onChange(listener: () => void): () => void;
};

declare module '@xcwds/core' {
	interface Settings {
		/** From `@xcwds/plugin-notion`: minutes before a copy is downloaded again; 0 = by hand. */
		notionRefreshMinutes: number;
	}
	interface App {
		/** From `@xcwds/plugin-notion`. */
		readonly notion?: AppNotion;
	}
}

/** The default for `notionRefreshMinutes`. */
export const REFRESH_MINUTES = 30;
const MAX_MINUTES = 24 * 60;

const MESSAGES: Record<Exclude<SourceError, NotionErrorKind>, string> = {
	'not-connected': 'Connect to Notion first.',
	'too-large': 'This page is too long to keep on the device (over 1 MB).',
	full: 'There’s no room for this page: the saved copies would take over 2 MB. Remove a source.',
	'not-saved': 'The copy couldn’t be saved on this device.'
};

/** A token as Notion issues them: no spaces, and not absurdly long. */
const parseToken = (v: unknown) =>
	typeof v === 'string' && /^[\x21-\x7e]{10,200}$/.test(v) ? v : undefined;

const parseMinutes = (v: unknown) =>
	typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_MINUTES ? v : undefined;

/** The browser APIs the plugin uses; the real ones unless a test passes its own. */
export type NotionPluginEnv = {
	fetch?: typeof fetch;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	now?: () => number;
};

/**
 * Makes the plugin with the browser APIs in `env` (tests pass stand-ins); the default export uses
 * the real ones.
 */
export function notionPlugin(env: NotionPluginEnv = {}) {
	return definePlugin(
		(app, input: NotionPluginOptions) => {
			const options = resolveOptions(input);
			const now = env.now ?? (() => Date.now());

			app.settings.field('notionRefreshMinutes', {
				default: REFRESH_MINUTES,
				parse: parseMinutes,
				label: 'Download Notion pages again after',
				hint: 'When the app opens or comes back, for copies older than this. 0: only with Refresh.',
				section: 'notion',
				control: { type: 'number', min: 0, max: MAX_MINUTES, step: 5, unit: 'min' }
			});
			const token = app.storage.entry('token', {
				label: 'Notion connection',
				parse: parseToken,
				group: 'notion-connection',
				sensitive: true,
				// A backup file must never carry the token, and restoring one mustn't sign you out.
				backup: false
			});
			const sourcesEntry = app.storage.entry('sources', {
				label: 'Notion sources',
				parse: parseSources
			});
			const copies = app.storage.entry('copies', {
				label: 'Notion page copies',
				parse: parseCopies,
				sensitive: true,
				backup: false
			});

			const statuses = new Map<string, SourceStatus>();
			const running = new Map<string, Promise<SourceStatus>>();
			const listeners = new Set<() => void>();
			const notify = () => {
				for (const listener of listeners) listener();
			};
			/** Bumped on connect and disconnect, so a download from before is thrown away. */
			let generation = 0;
			let controller: AbortController | undefined;

			const read = <T>(entry: Entry<T>) => app.storage.read(entry);
			const savedCopies = () => read(copies) ?? {};
			const sources = () => read(sourcesEntry) ?? [];
			const status = (id: string): SourceStatus => statuses.get(id) ?? { downloading: false };
			const set = (id: string, next: SourceStatus) => {
				statuses.set(id, next);
				notify();
				return next;
			};
			const failed = (error: SourceError): Omit<SourceStatus, 'downloading'> => ({
				error,
				message:
					error in MESSAGES
						? MESSAGES[error as keyof typeof MESSAGES]
						: new NotionError(error as NotionErrorKind).message
			});

			function stale(id: string) {
				const copy = savedCopies()[id];
				if (!copy) return true;
				const minutes = app.settings.get().notionRefreshMinutes ?? REFRESH_MINUTES;
				return minutes > 0 && now() - copy.fetchedAt >= minutes * 60_000;
			}

			async function run(source: Source): Promise<SourceStatus> {
				const saved = read(token);
				if (!saved) return set(source.id, { downloading: false, ...failed('not-connected') });
				const started = generation;
				controller ??= new AbortController();
				const client = createNotionClient({
					relay: options.relay,
					token: saved,
					signal: controller.signal,
					...(env.fetch ? { fetch: env.fetch } : {}),
					...(env.sleep ? { sleep: env.sleep } : {}),
					now
				});
				set(source.id, { ...status(source.id), downloading: true });
				let copy: NotionDocument | undefined;
				try {
					copy = await download(client, source, now);
				} catch (error) {
					const kind = error instanceof NotionError ? error.kind : 'failed';
					return set(source.id, { downloading: false, ...failed(kind) });
				}
				// Disconnected (or connected again) meanwhile, or the source was removed.
				if (started !== generation || !sources().some((s) => s.id === source.id))
					return set(source.id, { downloading: false });
				if (!copy) return set(source.id, { downloading: false, empty: true });
				const fit = fitCopy(savedCopies(), source.id, copy);
				if (fit !== 'ok') return set(source.id, { downloading: false, ...failed(fit) });
				const { saved: ok } = app.storage.update(copies, savedCopies(), (latest) => ({
					...(latest ?? {}),
					[source.id]: copy
				}));
				return set(
					source.id,
					ok ? { downloading: false } : { downloading: false, ...failed('not-saved') }
				);
			}

			function refresh(id: string, { force = false } = {}): Promise<SourceStatus> {
				const inFlight = running.get(id);
				if (inFlight) return inFlight;
				const source = sources().find((s) => s.id === id);
				if (!source) return Promise.resolve(status(id));
				if (!force && !stale(id)) return Promise.resolve(status(id));
				const job = run(source).finally(() => running.delete(id));
				running.set(id, job);
				return job;
			}

			const notion: AppNotion = {
				relay: options.relay,
				page: options.page,
				connected: () => read(token) !== undefined,
				async connect(value) {
					const candidate = value.trim();
					if (!parseToken(candidate))
						return {
							ok: false,
							error: 'unauthorized',
							message: new NotionError('unauthorized').message
						};
					const client = createNotionClient({
						relay: options.relay,
						token: candidate,
						...(env.fetch ? { fetch: env.fetch } : {}),
						...(env.sleep ? { sleep: env.sleep } : {}),
						now
					});
					try {
						const me = await client.me();
						if (!app.storage.write(token, candidate))
							return { ok: false, error: 'not-saved', message: MESSAGES['not-saved'] };
						generation++;
						statuses.clear();
						notify();
						return { ok: true, name: typeof me.name === 'string' ? me.name : '' };
					} catch (error) {
						const kind = error instanceof NotionError ? error.kind : 'failed';
						return { ok: false, error: kind, message: failed(kind).message! };
					}
				},
				disconnect() {
					generation++;
					controller?.abort();
					controller = undefined;
					app.storage.remove(token);
					app.storage.remove(copies);
					statuses.clear();
					notify();
				},
				sources,
				saveSources(change) {
					const { value, saved } = app.storage.update(sourcesEntry, sources(), (latest) =>
						change(latest ?? [])
					);
					if (saved) {
						const keep = new Set((value ?? []).map((s) => s.id));
						const current = savedCopies();
						if (Object.keys(current).some((id) => !keep.has(id))) {
							app.storage.update(copies, current, (latest) =>
								Object.fromEntries(Object.entries(latest ?? {}).filter(([id]) => keep.has(id)))
							);
						}
						for (const id of [...statuses.keys()]) if (!keep.has(id)) statuses.delete(id);
					}
					notify();
					return saved;
				},
				copy: (id) => savedCopies()[id],
				status,
				stale,
				refresh,
				onChange(listener) {
					listeners.add(listener);
					return () => void listeners.delete(listener);
				}
			};
			app.decorate('notion', notion);

			app.addHook('onVisible', () => {
				if (!notion.connected()) return;
				for (const source of sources()) void refresh(source.id);
			});
			app.addHook('onHidden', () => {
				// The browser may freeze the page: stop downloads rather than leave them hanging.
				controller?.abort();
				controller = undefined;
			});
			app.addHook('onStorageChange', (key) => {
				if (key === null || key === token.key || key === sourcesEntry.key || key === copies.key)
					notify();
			});
			app.addHook('onBeforeReload', () => (running.size ? 'Notion download' : undefined));
			app.addHook('onClose', () => {
				controller?.abort();
				controller = undefined;
				listeners.clear();
			});
		},
		{
			name: NAME,
			core: CORE,
			encapsulate: false,
			network: (options) => ({
				origins: [resolveOptions(options).relay],
				reason: REASON
			})
		}
	);
}

export default notionPlugin();
