/**
 * Sources for `@xcwds/plugin-notion` (#106): what to download, and downloading it. A source is
 * one page, the newest page of a database (the daily-agenda case: a scheduled task adds a page
 * each morning), or the newest child page under a parent page. `download` finds the page a source
 * points at now and returns it in the saved format (`./document`).
 *
 * Also here: the checks the saved entries use (`parseSources`, `parseCopies`), the size caps a
 * copy must fit (`fitCopy`), and `fromToday`, so yesterday's agenda isn't mistaken for today's.
 */
import { NotionError, parseId, type NotionClient, type RawObject } from './api.js';
import {
	DOCUMENT_VERSION,
	toDocument,
	type Block,
	type ImageLinks,
	type NotionDocument
} from './document.js';

/** What to download, with the label people gave it. */
export type Source = { id: string; label: string } & (
	| { kind: 'page'; page: string }
	| {
			kind: 'database';
			/** The data source queried (a database has one or more). */
			dataSource: string;
			/** Newest by when pages were created, or by a date property. */
			sort: { by: 'created' } | { by: 'property'; property: string };
			/** Only pages whose title contains this, when set. */
			title?: string;
	  }
	| { kind: 'child'; parent: string }
);

/** The largest copy saved, and the most all copies may take (`localStorage` is ~5 MB). */
export const COPY_LIMIT = 1024 * 1024;
export const TOTAL_LIMIT = 2 * 1024 * 1024;
/** The longest label and title filter kept. */
const TEXT_LIMIT = 200;

/**
 * The image caps (#108): one image at most `IMAGE_LIMIT` bytes, and a source's images together at
 * most `SOURCE_IMAGES_LIMIT` bytes and `MAX_IMAGES` images. Past them, an image says why it's
 * missing instead.
 */
export const IMAGE_LIMIT = 5 * 1024 * 1024;
export const SOURCE_IMAGES_LIMIT = 20 * 1024 * 1024;
export const MAX_IMAGES = 50;

/** What a source needs of the client. */
export type SourceClient = Pick<
	NotionClient,
	'page' | 'database' | 'dataSource' | 'query' | 'allChildren' | 'blocks' | 'file'
>;

/** Where a download keeps the images it fetches (the plugin's image collection). */
export type ImageStore = {
	/**
	 * An image already saved for this file (`imageKey`), reused instead of downloading it again,
	 * with its size.
	 */
	find(key: string): { id: string; size: number } | undefined;
	/** Saves one: its id, or false if it couldn't be saved. */
	save(blob: Blob, key: string): Promise<string | false>;
};

/**
 * What stays the same about an image Notion hosts between downloads: its link without the
 * signature, which changes every time.
 */
export function imageKey(link: string): string {
	if (!URL.canParse(link)) return link;
	const { origin, pathname } = new URL(link);
	return origin + pathname;
}

/** Downloads the images in `links` into `store`, within the caps, filling in each block. */
async function saveImages(client: SourceClient, links: ImageLinks, store: ImageStore) {
	let count = 0;
	let bytes = 0;
	for (const [block, link] of links) {
		if (count >= MAX_IMAGES) {
			block.skipped = 'full';
			continue;
		}
		count++;
		const key = imageKey(link);
		const saved = store.find(key);
		if (saved) {
			if (bytes + saved.size > SOURCE_IMAGES_LIMIT) {
				block.skipped = 'full';
				continue;
			}
			bytes += saved.size;
			delete block.skipped;
			block.file = saved.id;
			continue;
		}
		const result = await client.file(link, IMAGE_LIMIT);
		if (!result.ok) {
			block.skipped = result.reason;
			continue;
		}
		if (bytes + result.blob.size > SOURCE_IMAGES_LIMIT) {
			block.skipped = 'full';
			continue;
		}
		const id = await store.save(result.blob, key);
		if (!id) {
			block.skipped = 'not-saved';
			continue;
		}
		bytes += result.blob.size;
		delete block.skipped;
		block.file = id;
	}
}

/** The ids of the saved images a copy shows. */
export function imageIds(copy: NotionDocument): Set<string> {
	const ids = new Set<string>();
	const walk = (blocks: readonly Block[]) => {
		for (const block of blocks) {
			if (block.type === 'image' && block.file) ids.add(block.file);
			if ('children' in block && block.children) walk(block.children);
			if (block.type === 'columns') for (const column of block.columns) walk(column);
		}
	};
	walk(copy.blocks);
	return ids;
}

/** A database's data sources, to choose from when it has several. */
export async function dataSources(
	client: Pick<NotionClient, 'database'>,
	database: string
): Promise<{ id: string; name: string }[]> {
	const raw = await client.database(database);
	const list = Array.isArray(raw.data_sources) ? raw.data_sources : [];
	return list.flatMap((item: unknown) => {
		const source = item as { id?: unknown; name?: unknown };
		return typeof source?.id === 'string'
			? [{ id: source.id, name: typeof source.name === 'string' ? source.name : '' }]
			: [];
	});
}

/** The name of a data source's title property (every data source has one). */
async function titleProperty(client: Pick<NotionClient, 'dataSource'>, dataSource: string) {
	const raw = await client.dataSource(dataSource);
	for (const [name, value] of Object.entries((raw.properties ?? {}) as Record<string, unknown>)) {
		if ((value as { type?: unknown })?.type === 'title') return name;
	}
	return undefined;
}

/** The query that finds a database source's newest page. */
export function newestQuery(
	source: Extract<Source, { kind: 'database' }>,
	titleName?: string
): Record<string, unknown> {
	const filters: Record<string, unknown>[] = [];
	if (source.sort.by === 'property') {
		filters.push({ property: source.sort.property, date: { is_not_empty: true } });
	}
	if (source.title && titleName) {
		filters.push({ property: titleName, title: { contains: source.title } });
	}
	return {
		page_size: 1,
		sorts: [
			source.sort.by === 'created'
				? { timestamp: 'created_time', direction: 'descending' }
				: { property: source.sort.property, direction: 'descending' }
		],
		...(filters.length === 1 ? { filter: filters[0] } : {}),
		...(filters.length > 1 ? { filter: { and: filters } } : {})
	};
}

/** The id of the page a source points at now, or `undefined` when there's none yet. */
export async function resolve(client: SourceClient, source: Source): Promise<string | undefined> {
	switch (source.kind) {
		case 'page':
			return source.page;
		case 'database': {
			const titleName = source.title ? await titleProperty(client, source.dataSource) : undefined;
			// Never the newest page of the whole database shown as if it matched.
			if (source.title && !titleName) throw new NotionError('failed');
			const { results } = await client.query(source.dataSource, newestQuery(source, titleName));
			return results[0]?.id;
		}
		case 'child': {
			// Notion lists children in order, so the one added last is last.
			const children = await client.allChildren(source.parent);
			return children.filter((block) => block.type === 'child_page').at(-1)?.id;
		}
	}
}

/**
 * Downloads the page `source` points at now, in the saved format, or `undefined` when a
 * "newest" source has no page yet. With `images`, the images Notion hosts are downloaded into it
 * too (within the caps); without, they're left out. Failures are `NotionError`s; images that fail
 * on their own only say so in their block.
 */
export async function download(
	client: SourceClient,
	source: Source,
	now: () => number = Date.now,
	images?: ImageStore
): Promise<NotionDocument | undefined> {
	const id = await resolve(client, source);
	if (!id) return undefined;
	const page: RawObject = await client.page(id);
	const { blocks, truncated } = await client.blocks(id);
	const links: ImageLinks = new Map();
	const copy = toDocument(page, blocks, {
		fetchedAt: now(),
		truncated,
		...(images ? { images: links } : {})
	});
	if (images) await saveImages(client, links, images);
	return copy;
}

/**
 * Whether `createdTime` falls on today's date where the person is. A bare date (`2026-10-22`, a
 * date property's value) is a date on their calendar, not midnight UTC.
 */
export function fromToday(createdTime: string | null, now: number = Date.now()): boolean {
	if (!createdTime) return false;
	const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(createdTime);
	const created = day
		? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
		: new Date(createdTime);
	if (Number.isNaN(created.getTime())) return false;
	const today = new Date(now);
	return (
		created.getFullYear() === today.getFullYear() &&
		created.getMonth() === today.getMonth() &&
		created.getDate() === today.getDate()
	);
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * Whether `copy` can be saved for `id` alongside the other `copies` (the one it replaces doesn't
 * count): `'too-large'` over `COPY_LIMIT`, `'full'` when all of them would pass `TOTAL_LIMIT`.
 */
export function fitCopy(
	copies: Record<string, NotionDocument>,
	id: string,
	copy: NotionDocument
): 'ok' | 'too-large' | 'full' {
	const size = bytes(copy);
	if (size > COPY_LIMIT) return 'too-large';
	let total = size;
	for (const [other, saved] of Object.entries(copies)) if (other !== id) total += bytes(saved);
	return total > TOTAL_LIMIT ? 'full' : 'ok';
}

const text = (value: unknown, required = true): value is string =>
	typeof value === 'string' && value.length <= TEXT_LIMIT && (!required || value.trim() !== '');
const id = (value: unknown): value is string =>
	typeof value === 'string' && parseId(value) === value;

/** A saved source, or `undefined` if it isn't one. */
function parseSource(value: unknown): Source | undefined {
	const raw = (value ?? {}) as Record<string, unknown>;
	if (!text(raw.id) || !text(raw.label)) return undefined;
	const base = { id: raw.id, label: raw.label };
	switch (raw.kind) {
		case 'page':
			return id(raw.page) ? { ...base, kind: 'page', page: raw.page } : undefined;
		case 'child':
			return id(raw.parent) ? { ...base, kind: 'child', parent: raw.parent } : undefined;
		case 'database': {
			if (!id(raw.dataSource)) return undefined;
			const sort = (raw.sort ?? {}) as Record<string, unknown>;
			const parsed =
				sort.by === 'created'
					? ({ by: 'created' } as const)
					: sort.by === 'property' && text(sort.property)
						? ({ by: 'property', property: sort.property } as const)
						: undefined;
			if (!parsed) return undefined;
			if (raw.title !== undefined && !text(raw.title, false)) return undefined;
			return {
				...base,
				kind: 'database',
				dataSource: raw.dataSource,
				sort: parsed,
				...(raw.title ? { title: raw.title as string } : {})
			};
		}
	}
	return undefined;
}

/**
 * The saved sources (`app:notion:sources`), or `undefined` when the value isn't a list of them
 * with distinct ids. Ids are Notion's, dashed and lower case, as `parseId` gives them.
 */
export function parseSources(value: unknown): Source[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const sources: Source[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const source = parseSource(item);
		if (!source || seen.has(source.id)) return undefined;
		seen.add(source.id);
		sources.push(source);
	}
	return sources;
}

/**
 * The saved copies (`app:notion:copies`, source id → document), or `undefined` when the value
 * isn't that. Only the document's outline is checked; the renderer copes with the rest.
 */
export function parseCopies(value: unknown): Record<string, NotionDocument> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	for (const copy of Object.values(value)) {
		const doc = copy as Partial<NotionDocument> | null;
		if (
			!doc ||
			doc.v !== DOCUMENT_VERSION ||
			typeof doc.id !== 'string' ||
			typeof doc.title !== 'string' ||
			typeof doc.fetchedAt !== 'number' ||
			!Array.isArray(doc.blocks) ||
			!Array.isArray(doc.properties)
		)
			return undefined;
	}
	return value as Record<string, NotionDocument>;
}
