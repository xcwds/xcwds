/**
 * `@xcwds/plugin-scanner/pages`: the pages of the scan in progress, kept in a blob collection
 * (`app.blobs`, `app:scanner:pages`) so an unfinished scan survives a reload. Each page is the
 * finished image (straightened, filtered, upright JPEG) that goes into the PDF as it is.
 * Framework-agnostic and safe to import during prerender: browser APIs are reached only when a
 * method is called.
 *
 * A blob's `meta` can't change once it's saved, so moving or retaking a page saves it again and
 * then deletes the old copy. Each page keeps its own id (`page`) through that, and a revision
 * (`rev`) that goes up with each copy: if the tab dies between the two steps, the newer copy wins
 * and the next `list()` deletes the older one.
 */
import type { BlobInfo, BlobScope, Collection } from '@xcwds/core';
import { FILTERS, type Filter } from './filters.js';

/** What a page's blob carries in `meta`. */
export interface PageMeta {
	/** The page's own id, the same through moves and retakes. */
	page: string;
	/** Goes up each time the page is saved again; the highest copy is the page. */
	rev: number;
	/** Where it sits in the scan: pages are listed by `order`, lowest first. */
	order: number;
	width: number;
	height: number;
	filter: Filter;
}

/** A page of the scan, without its image. */
export interface ScanPage {
	/** The page's id, for `get`, `move`, `retake` and `delete`. */
	id: string;
	width: number;
	height: number;
	filter: Filter;
	/** Bytes. */
	size: number;
	/** When this copy was saved, in ms since the epoch. */
	saved: number;
}

/** A finished page: an upright JPEG and its size in pixels. */
export interface PageInput {
	blob: Blob;
	width: number;
	height: number;
	/** Which filter made it. Default `original`. */
	filter?: Filter;
}

export type PageResult = { ok: true; id: string } | { ok: false; error: string };

export const PAGE_MESSAGES = {
	full: "The page couldn't be saved: this device's storage is full or blocked.",
	missing: 'That page is no longer here.',
	type: 'A page must be a JPEG image.',
	size: "A page's width and height must be whole numbers of pixels, 1 or more.",
	filter: `A page's filter must be ${FILTERS.join(', ')}.`
} as const;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isSide = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1;

/** Checks a page's `meta` (the pages collection's `validate`). */
export function parsePageMeta(raw: unknown): PageMeta | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const m = raw as Record<string, unknown>;
	if (typeof m.page !== 'string' || m.page === '') return undefined;
	if (!Number.isInteger(m.rev) || !isCount(m.rev)) return undefined;
	if (typeof m.order !== 'number' || !Number.isFinite(m.order)) return undefined;
	if (!isSide(m.width) || !isSide(m.height)) return undefined;
	if (!FILTERS.includes(m.filter as Filter)) return undefined;
	return {
		page: m.page,
		rev: m.rev,
		order: m.order,
		width: m.width,
		height: m.height,
		filter: m.filter as Filter
	};
}

export interface PageCollectionOptions {
	/** Default `pages`. */
	key?: string;
	/** Default `Scanned pages`. */
	label?: string;
	/** Default the namespace's. */
	group?: string;
}

/**
 * The options for the pages collection, to pass to `app.blobs.register`: personal (`sensitive`,
 * so a lock's reset clears them) and out of backups.
 */
export function pageCollection(options: PageCollectionOptions = {}) {
	return {
		key: options.key ?? 'pages',
		label: options.label ?? 'Scanned pages',
		...(options.group === undefined ? {} : { group: options.group }),
		sensitive: true,
		backup: false,
		validate: parsePageMeta
	} as const;
}

/** What the store uses of `app.blobs`. */
export type BlobsLike = Pick<
	BlobScope,
	'register' | 'put' | 'get' | 'list' | 'delete' | 'clear' | 'onChange' | 'persist'
>;

export interface PagesEnv {
	/** Makes a page id. Default a random UUID. */
	newId?: () => string | undefined;
}

export interface Pages {
	readonly collection: Collection<PageMeta>;
	/** The pages, in order. Also deletes copies a move or retake left behind. */
	list(): Promise<ScanPage[]>;
	/** A page's image. */
	get(id: string): Promise<Blob | undefined>;
	/**
	 * Adds a page at the end. The first one this session also asks the browser not to evict the
	 * app's data (`persist`), since it follows a tap; a refusal changes nothing.
	 */
	add(page: PageInput): Promise<PageResult>;
	/** Replaces a page's image, keeping its place. */
	retake(id: string, page: PageInput): Promise<PageResult>;
	/** Moves a page to `index` (0 is the first; clamped to the scan). False if it couldn't. */
	move(id: string, index: number): Promise<boolean>;
	/** Deletes a page. False if it couldn't. */
	delete(id: string): Promise<boolean>;
	/** Deletes every page ("Start over"). False if it couldn't. */
	clear(): Promise<boolean>;
	/** Every page's JPEG, in order, ready for `writePdf`. */
	jpegs(): Promise<Uint8Array[]>;
	/** Calls `listener` when the pages change: here, in another tab, or cleared. */
	onChange(listener: () => void): () => void;
}

/** A random v4 UUID; `crypto.randomUUID` needs a secure context, `getRandomValues` doesn't. */
function randomId(): string | undefined {
	const c = globalThis.crypto;
	if (typeof c?.randomUUID === 'function') return c.randomUUID();
	if (typeof c?.getRandomValues !== 'function') return undefined;
	const b = c.getRandomValues(new Uint8Array(16));
	b[6] = (b[6]! & 0x0f) | 0x40;
	b[8] = (b[8]! & 0x3f) | 0x80;
	const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One saved copy of a page. */
type Copy = { row: string; meta: PageMeta; info: BlobInfo<PageMeta> };

/** Whether `a` is a newer copy of its page than `b`. */
const newer = (a: Copy, b: Copy) =>
	a.meta.rev !== b.meta.rev
		? a.meta.rev > b.meta.rev
		: a.info.created !== b.info.created
			? a.info.created > b.info.created
			: a.row > b.row;

function checkInput(page: PageInput): string | null {
	if (typeof Blob === 'undefined' || !(page?.blob instanceof Blob)) return PAGE_MESSAGES.type;
	if (page.blob.type !== 'image/jpeg') return PAGE_MESSAGES.type;
	if (!isSide(page.width) || !isSide(page.height)) return PAGE_MESSAGES.size;
	if (page.filter !== undefined && !FILTERS.includes(page.filter)) return PAGE_MESSAGES.filter;
	return null;
}

/**
 * The scan's pages over `blobs` (an `app.blobs`): registers the collection `pageCollection(options)`
 * describes, so call it once per key, as the plugin is set up. Changes made in this tab run one at
 * a time, in the order they were asked for.
 */
export function createPages(
	blobs: BlobsLike,
	options: PageCollectionOptions = {},
	env: PagesEnv = {}
): Pages {
	const collection = blobs.register<PageMeta>(pageCollection(options));
	let persisted = false;
	/** This tab's own changes; `app.blobs` reports other tabs' and clears. */
	const local = new Set<() => void>();
	const changed = () => {
		for (const listener of [...local]) listener();
	};

	let queue: Promise<unknown> = Promise.resolve();
	/** Runs `task` after this tab's earlier changes, so two quick moves never read the same list. */
	function serial<T>(task: () => Promise<T>): Promise<T> {
		const run = queue.then(task, task);
		queue = run.catch(() => {});
		return run;
	}

	/** The pages in order (the newest copy of each), and the older copies left behind. */
	async function read(): Promise<{ pages: Copy[]; stale: string[] }> {
		const latest = new Map<string, Copy>();
		const stale: string[] = [];
		for (const info of await blobs.list(collection)) {
			// A copy whose meta no longer passes can't be placed: it's left out, not shown wrong.
			if (!info.meta) continue;
			const copy: Copy = { row: info.id, meta: info.meta, info };
			const seen = latest.get(info.meta.page);
			if (!seen) latest.set(info.meta.page, copy);
			else if (newer(copy, seen)) {
				stale.push(seen.row);
				latest.set(info.meta.page, copy);
			} else stale.push(copy.row);
		}
		const pages = [...latest.values()].sort(
			(a, b) => a.meta.order - b.meta.order || (a.meta.page < b.meta.page ? -1 : 1)
		);
		return { pages, stale };
	}

	/** Every saved copy of page `id`. */
	async function copiesOf(id: string): Promise<string[]> {
		return (await blobs.list(collection)).filter((i) => i.meta?.page === id).map((i) => i.id);
	}

	/**
	 * Saves `blob` as the next copy of `copy`'s page with `changes`, then deletes every older copy.
	 * The new copy's row id, or false when it couldn't be saved.
	 */
	async function resave(
		copy: Copy,
		blob: Blob,
		changes: Partial<PageMeta>
	): Promise<string | false> {
		const older = await copiesOf(copy.meta.page);
		const row = await blobs.put(collection, blob, {
			...copy.meta,
			...changes,
			rev: copy.meta.rev + 1
		});
		if (!row) return false;
		// An older copy left behind loses to this one and goes at the next `list()`.
		for (const id of older) await blobs.delete(collection, id);
		return row;
	}

	const find = (pages: Copy[], id: string) => pages.find((p) => p.meta.page === id);

	const pages: Pages = {
		collection,
		async list() {
			const { pages: found, stale } = await read();
			for (const row of stale) await blobs.delete(collection, row);
			return found.map((p) => ({
				id: p.meta.page,
				width: p.meta.width,
				height: p.meta.height,
				filter: p.meta.filter,
				size: p.info.size,
				saved: p.info.created
			}));
		},
		async get(id) {
			const copy = find((await read()).pages, id);
			return copy ? (await blobs.get(collection, copy.row))?.blob : undefined;
		},
		add(page) {
			return serial(async (): Promise<PageResult> => {
				const bad = checkInput(page);
				if (bad) return { ok: false, error: bad };
				const id = (env.newId ?? randomId)();
				if (!id) return { ok: false, error: PAGE_MESSAGES.full };
				const { pages: found } = await read();
				const last = found.at(-1);
				const row = await blobs.put(collection, page.blob, {
					page: id,
					rev: 0,
					order: last ? Math.floor(last.meta.order) + 1 : 0,
					width: page.width,
					height: page.height,
					filter: page.filter ?? 'original'
				});
				if (!row) return { ok: false, error: PAGE_MESSAGES.full };
				changed();
				if (!persisted) {
					persisted = true;
					await blobs.persist().catch(() => 'denied');
				}
				return { ok: true, id };
			});
		},
		retake(id, page) {
			return serial(async (): Promise<PageResult> => {
				const bad = checkInput(page);
				if (bad) return { ok: false, error: bad };
				const copy = find((await read()).pages, id);
				if (!copy) return { ok: false, error: PAGE_MESSAGES.missing };
				const row = await resave(copy, page.blob, {
					width: page.width,
					height: page.height,
					filter: page.filter ?? 'original'
				});
				if (!row) return { ok: false, error: PAGE_MESSAGES.full };
				changed();
				return { ok: true, id };
			});
		},
		move(id, index) {
			return serial(async () => {
				if (typeof index !== 'number' || Number.isNaN(index)) return false;
				const { pages: found } = await read();
				const from = found.findIndex((p) => p.meta.page === id);
				if (from === -1) return false;
				const to = Math.min(Math.max(Math.trunc(index), 0), found.length - 1);
				if (to === from) return true;
				const [copy] = found.splice(from, 1) as [Copy];
				found.splice(to, 0, copy);
				const before = found[to - 1]?.meta.order;
				const after = found[to + 1]?.meta.order;
				const order =
					before === undefined
						? after! - 1
						: after === undefined
							? before + 1
							: before + (after - before) / 2;
				// Only the moved page is saved again, unless halving has run out of room between its
				// neighbours: then every page that's out of place gets a whole number.
				const moves =
					(before === undefined || order > before) && (after === undefined || order < after)
						? [{ copy, order }]
						: found
								.map((p, i) => ({ copy: p, order: i }))
								.filter((m) => m.copy.meta.order !== m.order);
				let ok = true;
				for (const m of moves) {
					const got = await blobs.get(collection, m.copy.row);
					if (!got || !(await resave(m.copy, got.blob, { order: m.order }))) ok = false;
				}
				changed();
				return ok;
			});
		},
		delete(id) {
			return serial(async () => {
				const rows = await copiesOf(id);
				let ok = true;
				for (const row of rows) if (!(await blobs.delete(collection, row))) ok = false;
				if (rows.length) changed();
				return ok;
			});
		},
		clear() {
			// `app.blobs.clear` tells this tab's listeners itself.
			return serial(() => blobs.clear(collection));
		},
		async jpegs() {
			const out: Uint8Array[] = [];
			for (const copy of (await read()).pages) {
				const got = await blobs.get(collection, copy.row);
				if (got) out.push(new Uint8Array(await got.blob.arrayBuffer()));
			}
			return out;
		},
		onChange(listener) {
			local.add(listener);
			const stop = blobs.onChange((key) => {
				if (key === null || key === collection.key) listener();
			});
			return () => {
				local.delete(listener);
				stop();
			};
		}
	};
	return pages;
}
