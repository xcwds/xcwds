/**
 * The page entry (#106): saves the connection, the sources and their copies, and hands pages
 * `app.notion` to connect, choose sources and download them.
 *
 * - **Saved data** (namespace `notion`): the token (`app:notion:token`, its own group "Notion
 *   connection", personal and never in backups), the sources (`app:notion:sources`, in backups)
 *   and the latest copy of each (`app:notion:copies`, personal and out of backups, since it can
 *   be downloaded again). Copies stay within `COPY_LIMIT` and `TOTAL_LIMIT`.
 * - **Images** (#108): the images Notion hosts are downloaded with their page into a blob
 *   collection (`app:notion:images`, personal, never in backups), within the caps in `./sources`.
 *   A copy keeps only their ids. An image already saved for the same file is reused; the ones a
 *   new copy no longer shows, and those of removed sources, are deleted, and Disconnect deletes
 *   them all.
 * - **Refreshing:** a page calls `refresh(id)` when it shows a source; the app coming back to the
 *   foreground (`onVisible`) refreshes every source whose copy is older than the
 *   `notionRefreshMinutes` setting (30 by default; 0 = only by hand). Going to the background
 *   (`onHidden`) cancels downloads in flight, and copies already saved stay.
 * - **Changes** (#109, with `writes`): ticking a to-do and adding a note queue in an outbox
 *   (`app:notion:outbox`, personal and never in backups) that the copy shows at once. They're sent
 *   when made, when the connection comes back (`online`), when the app comes back to the
 *   foreground and before a source is downloaded again; one send at a time, across tabs too (a
 *   Web Lock). The copies they changed are downloaded again afterwards, so a tick Notion had the
 *   other way shows Notion's, and `conflicts()` says so. Disconnect clears the outbox.
 * - **Updates wait** while a download runs or changes are being sent (`onBeforeReload`). A queued
 *   change is saved, so it survives a reload anyway; updates don't wait for an outbox that can't be
 *   sent, offline say.
 *
 * The token never goes into a URL, an error message or a status. Imported at prerender too, so
 * it only reaches browser globals once a download runs.
 */
import { definePlugin, type BlobInfo, type Entry } from '@xcwds/core';
import { NotionError, createNotionClient, type NotionErrorKind } from './api.js';
import type { Block, NotionDocument } from './document.js';
import { CORE, NAME, reason, resolveOptions, type NotionPluginOptions } from './options.js';
import {
	applyOutbox,
	discard as discardItem,
	emptyOutbox,
	enqueue,
	flush,
	noteParagraphs,
	parseOutbox,
	retry as retryItem,
	type Outbox,
	type OutboxChange,
	type OutboxItem
} from './outbox.js';
import {
	dataSources,
	download,
	fitCopy,
	imageIds,
	parseCopies,
	parseSources,
	type ImageStore,
	type Source
} from './sources.js';

export type { NotionDocument } from './document.js';
export type { Source } from './sources.js';
export type { OutboxChange, OutboxItem } from './outbox.js';

/** A tick Notion had the other way, edited there meanwhile: Notion's stays. */
export type NotionConflict = { item: OutboxItem; checked: boolean };

/** What sending the waiting changes came to. */
export type SendSummary = {
	sent: number;
	conflicts: number;
	/** Refused by Notion this time; they stay in the outbox with why, until `retry` or `discard`. */
	failed: number;
	/** Still waiting to be sent. */
	waiting: number;
	/** Why sending stopped early (no connection, say), with a message safe to show. */
	error?: SourceError;
	message?: string;
};

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
	/**
	 * A database's data sources (most have one), to choose from when adding a "newest in a
	 * database" source; or why they couldn't be listed.
	 */
	dataSources(
		database: string
	): Promise<
		| { ok: true; dataSources: { id: string; name: string }[] }
		| { ok: false; error: SourceError; message: string }
	>;
	/** The saved sources, in order. */
	sources(): Source[];
	/**
	 * Saves the sources (from the latest saved list); copies of removed ones go too. False, and
	 * nothing saved, when the list has a source that isn't valid (`parseSources`).
	 */
	saveSources(change: (sources: Source[]) => Source[]): boolean;
	/** A source's saved copy. */
	copy(id: string): NotionDocument | undefined;
	/** A saved image a copy shows (its block's `file`), or `undefined` if it isn't on the device. */
	image(id: string): Promise<Blob | undefined>;
	status(id: string): SourceStatus;
	/** Whether a source's copy is older than the refresh setting (or missing). */
	stale(id: string): boolean;
	/** Downloads a source again (only if `stale`, unless `force`); its status afterwards. */
	refresh(id: string, options?: { force?: boolean }): Promise<SourceStatus>;
	/** Called when sources, copies, statuses, the outbox or the connection change. */
	onChange(listener: () => void): () => void;

	/** Whether people can change saved pages (the `writes` option); the calls below need it. */
	readonly writes: boolean;
	/** The changes waiting to be sent, refused ones included (`failed`), in order. */
	outbox(): OutboxItem[];
	/**
	 * Queues a change to `source`'s copy (a tick of one of its to-dos, or a note at its end), which
	 * `copy` shows at once, and starts sending it. False, and nothing queued, without `writes` or a
	 * copy, for a block that isn't one of the copy's to-dos, a note `noteParagraphs` refuses, or
	 * when it couldn't be saved.
	 */
	change(source: string, change: OutboxChange): boolean;
	/** Sends a refused change again. */
	retry(id: string): boolean;
	/** Drops a queued change. */
	discard(id: string): boolean;
	/**
	 * Sends the waiting changes now, in order, then downloads again the copies they changed. One
	 * send runs at a time, across tabs too.
	 */
	send(): Promise<SendSummary>;
	/** Whether changes are being sent. */
	sending(): boolean;
	/** The ticks Notion had the other way since `clearConflicts`, to tell the person. */
	conflicts(): NotionConflict[];
	clearConflicts(): void;
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

/** What each saved image records: the source it belongs to, and its file (`imageKey`). */
type ImageMeta = { source: string; key: string };
const parseImageMeta = (v: unknown): ImageMeta | undefined => {
	const meta = (v ?? {}) as Record<string, unknown>;
	return typeof meta.source === 'string' && typeof meta.key === 'string'
		? { source: meta.source, key: meta.key }
		: undefined;
};

const parseMinutes = (v: unknown) =>
	typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_MINUTES ? v : undefined;

/** What the plugin uses of `navigator.locks`. */
export type LocksLike = {
	request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

/** The browser APIs the plugin uses; the real ones unless a test passes its own. */
export type NotionPluginEnv = {
	fetch?: typeof fetch;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	now?: () => number;
	/** `navigator.locks` by default; `null` for none (one send at a time in this tab only). */
	locks?: LocksLike | null;
	/** Calls `listener` when the connection comes back; `window`'s `online` by default. */
	online?: (listener: () => void) => () => void;
};

/** The Web Lock that keeps sends to one tab at a time. */
export const SEND_LOCK = '@xcwds/plugin-notion:outbox';

/** Whether `blocks` hold a to-do with the block id `id`, at any depth. */
const hasTodo = (blocks: Block[], id: string): boolean =>
	blocks.some(
		(block) =>
			(block.type === 'todo' && block.id === id) ||
			('children' in block && !!block.children && hasTodo(block.children, id)) ||
			(block.type === 'columns' && block.columns.some((column) => hasTodo(column, id)))
	);

/** Thrown inside a send that must stop: disconnected meanwhile, or the outbox couldn't be saved. */
class StopSending extends Error {}

/**
 * Makes the plugin with the browser APIs in `env` (tests pass stand-ins); the default export uses
 * the real ones.
 */
export function notionPlugin(env: NotionPluginEnv = {}) {
	return definePlugin(
		(app, input: NotionPluginOptions) => {
			const options = resolveOptions(input);
			const now = env.now ?? (() => Date.now());
			const locks =
				env.locks === undefined
					? ((globalThis.navigator as { locks?: LocksLike } | undefined)?.locks ?? null)
					: env.locks;

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
			// Only with `writes`. Out of backups: a restored change could be sent a second time.
			const outboxEntry = options.writes
				? app.storage.entry('outbox', {
						label: 'Notion changes waiting to send',
						parse: parseOutbox,
						sensitive: true,
						backup: false
					})
				: undefined;
			// In the same group as the copies, so clearing one clears the other.
			const images = app.blobs.register<ImageMeta>({
				key: 'images',
				label: 'Notion images',
				sensitive: true,
				validate: parseImageMeta
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
			const savedOutbox = () => (outboxEntry && read(outboxEntry)) || emptyOutbox();
			/** Changes that can be sent (not refused), for `source` or all of them. */
			const waiting = (source?: string) =>
				savedOutbox().items.filter(
					(item) => !item.failed && (source === undefined || item.source === source)
				);
			/** Saves `change` applied to the latest outbox; an empty one is removed. */
			const updateOutbox = (change: (latest: Outbox) => Outbox) => {
				if (!outboxEntry) return { value: emptyOutbox(), saved: false };
				const { value, saved } = app.storage.update(outboxEntry, savedOutbox(), (latest) => {
					const next = change(latest ?? emptyOutbox());
					return next.items.length || Object.keys(next.written).length ? next : undefined;
				});
				notify();
				return { value: value ?? emptyOutbox(), saved };
			};
			let conflicts: NotionConflict[] = [];
			let sendJob: Promise<{ summary: SendSummary; refreshed: Set<string> }> | undefined;
			const clientFor = (saved: string, signal?: AbortSignal) =>
				createNotionClient({
					relay: options.relay,
					token: saved,
					...(signal ? { signal } : {}),
					...(env.fetch ? { fetch: env.fetch } : {}),
					...(env.sleep ? { sleep: env.sleep } : {}),
					now
				});
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
				const client = clientFor(saved, controller.signal);
				set(source.id, { ...status(source.id), downloading: true });
				// Real time, as the blob store records it: images saved from here on are this run's
				// or another tab's, and never pruned below.
				const startedAt = Date.now();
				const { store, added } = await imageStore(source.id);
				/** Deletes the images this run saved, when its copy isn't kept. */
				const discard = async () => {
					for (const id of added) await app.blobs.delete(images, id);
				};
				let copy: NotionDocument | undefined;
				try {
					copy = await download(client, source, now, store);
				} catch (error) {
					await discard();
					// From an earlier connection: its failure says nothing about this one.
					if (started !== generation) return set(source.id, { downloading: false });
					const kind = error instanceof NotionError ? error.kind : 'failed';
					return set(source.id, { downloading: false, ...failed(kind) });
				}
				// Disconnected (or connected again) meanwhile, or the source was removed.
				if (started !== generation || !sources().some((s) => s.id === source.id)) {
					await discard();
					return set(source.id, { downloading: false });
				}
				if (!copy) {
					await discard();
					return set(source.id, { downloading: false, empty: true });
				}
				const fit = fitCopy(savedCopies(), source.id, copy);
				if (fit !== 'ok') {
					await discard();
					return set(source.id, { downloading: false, ...failed(fit) });
				}
				const { saved: ok } = app.storage.update(copies, savedCopies(), (latest) => ({
					...(latest ?? {}),
					[source.id]: copy
				}));
				if (!ok) {
					await discard();
					return set(source.id, { downloading: false, ...failed('not-saved') });
				}
				// The images the copy it replaced showed and this one doesn't.
				const kept = imageIds(copy);
				await deleteImages(
					(row) => row.meta?.source === source.id && !kept.has(row.id) && row.created < startedAt
				);
				return set(source.id, { downloading: false });
			}

			/**
			 * Where a download of `source` keeps its images: the ones already saved for it are reused
			 * by file, and `added` collects the new ones.
			 */
			async function imageStore(source: string): Promise<{ store: ImageStore; added: string[] }> {
				const known = new Map<string, { id: string; size: number }>();
				for (const row of await app.blobs.list(images))
					if (row.meta?.source === source) known.set(row.meta.key, { id: row.id, size: row.size });
				const added: string[] = [];
				const store: ImageStore = {
					find: (key) => known.get(key),
					async save(blob, key) {
						const id = await app.blobs.put(images, blob, { source, key });
						if (!id) return false;
						added.push(id);
						// The same file twice on a page is saved once.
						known.set(key, { id, size: blob.size });
						return id;
					}
				};
				return { store, added };
			}

			/** Deletes the saved images `drop` picks. */
			async function deleteImages(drop: (row: BlobInfo<ImageMeta>) => boolean) {
				for (const row of await app.blobs.list(images))
					if (drop(row)) await app.blobs.delete(images, row.id);
			}

			/** Downloads a source again, without sending its changes first. */
			function fetchSource(id: string, force: boolean): Promise<SourceStatus> {
				const inFlight = running.get(id);
				if (inFlight) return inFlight;
				const source = sources().find((s) => s.id === id);
				if (!source) return Promise.resolve(status(id));
				if (!force && !stale(id)) return Promise.resolve(status(id));
				const job = run(source).finally(() => running.delete(id));
				running.set(id, job);
				return job;
			}

			function refresh(id: string, { force = false } = {}): Promise<SourceStatus> {
				const inFlight = running.get(id);
				if (inFlight) return inFlight;
				// Its changes go first, so the new copy has them; sending downloads it again then.
				if (!outboxEntry || !read(token) || !waiting(id).length) return fetchSource(id, force);
				return sendAll().then(({ refreshed }) =>
					refreshed.has(id) ? status(id) : fetchSource(id, force)
				);
			}

			const summarise = (
				outbox: Outbox,
				counts: Partial<SendSummary> = {},
				error?: SourceError
			): SendSummary => ({
				sent: 0,
				conflicts: 0,
				failed: 0,
				...counts,
				waiting: outbox.items.filter((item) => !item.failed).length,
				...(error ? failed(error) : {})
			});

			/** A change was queued while a send ran, which may have been past it: send again after. */
			let again = false;
			/**
			 * `send()`, and the sources it downloaded again. One at a time in this tab; `queued` says a
			 * change was just queued, so a send already running is followed by another.
			 */
			function sendAll({ queued = false } = {}) {
				if (sendJob) {
					again ||= queued;
					return sendJob;
				}
				sendJob = sendLocked().finally(() => {
					sendJob = undefined;
					if (again) {
						again = false;
						if (read(token) && waiting().length) void sendAll();
					}
					notify();
				});
				notify();
				return sendJob;
			}

			async function sendLocked(): Promise<{ summary: SendSummary; refreshed: Set<string> }> {
				const refreshed = new Set<string>();
				if (!outboxEntry) return { summary: summarise(emptyOutbox()), refreshed };
				const saved = read(token);
				if (!saved) return { summary: summarise(savedOutbox(), {}, 'not-connected'), refreshed };
				if (!waiting().length) return { summary: summarise(savedOutbox()), refreshed };
				const started = generation;
				const job = async () => {
					controller ??= new AbortController();
					const client = clientFor(saved, controller.signal);
					try {
						return await flush(client, (change) => {
							if (started !== generation) throw new StopSending();
							const { value, saved: ok } = updateOutbox(change);
							// Sending what couldn't be marked as sent could send it twice.
							if (!ok) throw new StopSending();
							return value;
						});
					} catch (error) {
						if (error instanceof StopSending) return undefined;
						throw error;
					}
				};
				// Another tab may have sent meanwhile: `flush` starts from the latest saved outbox.
				const result = await (locks ? locks.request(SEND_LOCK, job) : job());
				if (!result || started !== generation)
					return { summary: summarise(savedOutbox()), refreshed };
				if (result.conflicts.length) conflicts = [...conflicts, ...result.conflicts];
				// What they changed is in Notion now (or Notion's stays): download those copies again.
				for (const item of [...result.sent, ...result.conflicts.map((c) => c.item)])
					refreshed.add(item.source);
				// A download already running may have started before the write: wait, then start anew.
				await Promise.all(
					[...refreshed].map(async (id) => {
						await running.get(id);
						return fetchSource(id, true);
					})
				);
				return {
					summary: summarise(
						result.outbox,
						{
							sent: result.sent.length,
							conflicts: result.conflicts.length,
							failed: result.failed.length
						},
						result.stopped?.kind
					),
					refreshed
				};
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
					const client = clientFor(candidate);
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
				async dataSources(database) {
					const saved = read(token);
					if (!saved)
						return { ok: false, error: 'not-connected', message: MESSAGES['not-connected'] };
					const client = clientFor(saved);
					try {
						return { ok: true, dataSources: await dataSources(client, database) };
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
					if (outboxEntry) app.storage.remove(outboxEntry);
					void app.blobs.clear(images);
					statuses.clear();
					conflicts = [];
					notify();
				},
				sources,
				saveSources(change) {
					// One bad source would make the whole saved list unreadable: refuse it instead.
					let valid = true;
					const { value, saved } = app.storage.update(sourcesEntry, sources(), (latest) => {
						const next = parseSources(change(latest ?? []));
						if (!next) valid = false;
						return next ?? latest;
					});
					if (!valid) return false;
					if (saved) {
						const keep = new Set((value ?? []).map((s) => s.id));
						const current = savedCopies();
						if (Object.keys(current).some((id) => !keep.has(id))) {
							app.storage.update(copies, current, (latest) =>
								Object.fromEntries(Object.entries(latest ?? {}).filter(([id]) => keep.has(id)))
							);
						}
						for (const id of [...statuses.keys()]) if (!keep.has(id)) statuses.delete(id);
						void deleteImages((row) => !row.meta || !keep.has(row.meta.source));
					}
					notify();
					return saved;
				},
				copy(id) {
					const copy = savedCopies()[id];
					return copy && outboxEntry ? applyOutbox(copy, savedOutbox(), id) : copy;
				},
				image: async (id) => (await app.blobs.get(images, id))?.blob,
				status,
				stale,
				refresh,
				onChange(listener) {
					listeners.add(listener);
					return () => void listeners.delete(listener);
				},
				writes: options.writes,
				outbox: () => savedOutbox().items,
				change(id, change) {
					const copy = savedCopies()[id];
					if (!outboxEntry || !copy) return false;
					if (change.kind === 'check' && !hasTodo(copy.blocks, change.block)) return false;
					if (change.kind === 'note' && !noteParagraphs(change.text)) return false;
					const { saved } = updateOutbox((latest) =>
						enqueue(latest, change, {
							id: crypto.randomUUID(),
							source: id,
							page: copy.id,
							fetchedAt: copy.fetchedAt,
							now: now()
						})
					);
					if (!app.storage.saveResult(outboxEntry, saved, { explicit: true })) return false;
					if (read(token)) void sendAll({ queued: true });
					return true;
				},
				retry(id) {
					if (!outboxEntry) return false;
					const { saved } = updateOutbox((latest) => retryItem(latest, id));
					if (saved && read(token)) void sendAll({ queued: true });
					return saved;
				},
				discard(id) {
					if (!outboxEntry) return false;
					return updateOutbox((latest) => discardItem(latest, id)).saved;
				},
				send: async () => (await sendAll()).summary,
				sending: () => sendJob !== undefined,
				conflicts: () => conflicts,
				clearConflicts() {
					conflicts = [];
					notify();
				}
			};
			app.decorate('notion', notion);

			/** Sends what's waiting, if there's anything and a connection to send it with. */
			const sendWaiting = () => {
				if (outboxEntry && notion.connected() && waiting().length) void sendAll();
			};
			app.addHook('onVisible', () => {
				if (!notion.connected()) return;
				// Changes for a source that's been removed go too.
				sendWaiting();
				for (const source of sources()) void refresh(source.id);
			});
			let stopListening: (() => void) | undefined;
			app.addHook('onBoot', () => {
				if (!outboxEntry) return;
				if (env.online) stopListening = env.online(sendWaiting);
				else if (typeof window !== 'undefined') {
					window.addEventListener('online', sendWaiting);
					stopListening = () => window.removeEventListener('online', sendWaiting);
				}
			});
			app.addHook('onHidden', () => {
				// The browser may freeze the page: stop downloads rather than leave them hanging.
				controller?.abort();
				controller = undefined;
			});
			app.addHook('onStorageChange', (key) => {
				if (
					key === null ||
					key === token.key ||
					key === sourcesEntry.key ||
					key === copies.key ||
					key === outboxEntry?.key
				)
					notify();
			});
			app.addHook('onBeforeReload', () =>
				running.size ? 'Notion download' : sendJob ? 'Notion changes' : undefined
			);
			app.addHook('onClose', () => {
				stopListening?.();
				stopListening = undefined;
				controller?.abort();
				controller = undefined;
				listeners.clear();
			});
		},
		{
			name: NAME,
			core: CORE,
			encapsulate: false,
			network: (options) => {
				const resolved = resolveOptions(options);
				return { origins: [resolved.relay], reason: reason(resolved) };
			}
		}
	);
}

export default notionPlugin();
