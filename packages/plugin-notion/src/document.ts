/**
 * The plugin's own saved document format (#106): what a downloaded Notion page becomes. Only what
 * the renderer (#107) needs is kept: rich text with its annotations and links, page properties,
 * and the blocks listed in `Block`. Anything else becomes `{ type: 'unsupported', notionType }`.
 * Rendering reads only this shape, never Notion's responses, so a change in Notion's API stops
 * here; the shape itself changes only through the plugin's migrations (`v`).
 */
import type { RawBlock, RawObject } from './api.js';

/** The format's version. */
export const DOCUMENT_VERSION = 1;

/** Notion's colours, text and background (`red`, `blue_background`). */
export type Color = string;

/** A run of text with its formatting; only the flags that are on are present. */
export type RichText = {
	text: string;
	/** A link: as given by Notion, checked by the renderer before it becomes an `href`. */
	href?: string;
	bold?: true;
	italic?: true;
	strike?: true;
	underline?: true;
	code?: true;
	color?: Color;
};

type WithChildren = { children?: Block[] };

/**
 * Why an image isn't on the device: over the size cap for one image, past the cap for a source's
 * images, not an image the app shows, a failed download (an expired link, say), no room to save
 * it, or not downloaded at all (`toDocument` without `images`, or a kind Notion gives no link for).
 */
export type ImageSkip =
	'too-large' | 'full' | 'not-image' | 'failed' | 'not-saved' | 'not-downloaded';

/**
 * An image (#108). One Notion hosts is downloaded with the page and saved on the device: `file`
 * is its id in the plugin's image collection. One from elsewhere is `external`, a link that's
 * never loaded. Otherwise `skipped` says why it isn't shown. Notion's signed links expire within
 * the hour, so they're never kept.
 */
export type ImageBlock = {
	type: 'image';
	caption: RichText[];
	file?: string;
	external?: string;
	skipped?: ImageSkip;
};

/** A block of a saved page. */
export type Block =
	| ({ type: 'paragraph'; text: RichText[]; color?: Color } & WithChildren)
	| ({
			type: 'heading';
			level: 1 | 2 | 3;
			text: RichText[];
			color?: Color;
			toggle?: true;
	  } & WithChildren)
	| ({ type: 'bulleted'; text: RichText[]; color?: Color } & WithChildren)
	| ({ type: 'numbered'; text: RichText[]; color?: Color } & WithChildren)
	| ({
			type: 'todo';
			text: RichText[];
			checked: boolean;
			/** Its Notion block id, for ticking it (#109); copies from before then have none. */
			id?: string;
			color?: Color;
	  } & WithChildren)
	| ({ type: 'toggle'; text: RichText[]; color?: Color } & WithChildren)
	| ({ type: 'quote'; text: RichText[]; color?: Color } & WithChildren)
	| ({ type: 'callout'; text: RichText[]; icon?: string; color?: Color } & WithChildren)
	| { type: 'code'; text: RichText[]; language: string; caption: RichText[] }
	| { type: 'divider' }
	| { type: 'table'; columnHeader: boolean; rowHeader: boolean; rows: RichText[][][] }
	| { type: 'child_page'; id: string; title: string }
	| { type: 'child_database'; id: string; title: string }
	| { type: 'link_to_page'; id: string; kind: 'page' | 'database' }
	| { type: 'bookmark'; url: string; caption: RichText[] }
	| { type: 'embed'; url: string; caption: RichText[] }
	| { type: 'equation'; expression: string }
	| { type: 'columns'; columns: Block[][] }
	| ImageBlock
	/** A file, PDF, video or audio: a placeholder (and an image, in copies from before #108). */
	| { type: 'file'; notionType: string; caption: RichText[] }
	| { type: 'unsupported'; notionType: string };

/** A page property, in Notion's order (the title is the document's `title` instead). */
export type Property = { name: string } & (
	| { type: 'text'; text: RichText[] }
	| { type: 'number'; value: number | null }
	| { type: 'select'; value: string | null }
	| { type: 'multi_select'; value: string[] }
	| { type: 'date'; start: string | null; end: string | null }
	| { type: 'checkbox'; value: boolean }
	| { type: 'url' | 'email' | 'phone'; value: string | null }
);

/** A downloaded page. */
export type NotionDocument = {
	v: typeof DOCUMENT_VERSION;
	id: string;
	title: string;
	/** An emoji, when the page has one. */
	icon: string | null;
	/** The page in Notion. */
	url: string | null;
	createdTime: string | null;
	properties: Property[];
	blocks: Block[];
	/** When it was downloaded (ms). */
	fetchedAt: number;
	/** The page was longer or deeper than a download takes (`MAX_BLOCKS`, `MAX_DEPTH`). */
	truncated: boolean;
};

type Loose = Record<string, unknown>;
const obj = (value: unknown): Loose =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : {};
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Notion's rich text array as runs. Mentions and inline equations keep their text. */
export function richText(value: unknown): RichText[] {
	const runs: RichText[] = [];
	for (const item of list(value)) {
		const raw = obj(item);
		const text = str(raw.plain_text);
		if (!text) continue;
		const run: RichText = { text };
		const href = strOrNull(raw.href);
		if (href) run.href = href;
		const a = obj(raw.annotations);
		if (a.bold === true) run.bold = true;
		if (a.italic === true) run.italic = true;
		if (a.strikethrough === true) run.strike = true;
		if (a.underline === true) run.underline = true;
		if (a.code === true) run.code = true;
		if (typeof a.color === 'string' && a.color !== 'default') run.color = a.color;
		runs.push(run);
	}
	return runs;
}

/** The text of runs, without formatting. */
export const plainText = (runs: RichText[]) => runs.map((run) => run.text).join('');

const emoji = (icon: unknown): string | undefined => {
	const raw = obj(icon);
	return raw.type === 'emoji' && typeof raw.emoji === 'string' ? raw.emoji : undefined;
};

const color = (value: unknown): { color?: Color } =>
	typeof value === 'string' && value !== 'default' ? { color: value } : {};

const FILES = new Set(['file', 'pdf', 'video', 'audio']);

/**
 * The images to download: each image block Notion hosts, and its signed link, in page order.
 * `download` fills in each block's `file` (or `skipped`) from it.
 */
export type ImageLinks = Map<ImageBlock, string>;

/** An image block; one Notion hosts goes into `images`, when given, to be downloaded. */
function convertImage(data: Loose, images: ImageLinks | undefined): ImageBlock {
	const caption = richText(data.caption);
	if (data.type === 'external') {
		const external = str(obj(data.external).url);
		if (external) return { type: 'image', caption, external };
	}
	const block: ImageBlock = { type: 'image', caption, skipped: 'not-downloaded' };
	const link = data.type === 'file' ? str(obj(data.file).url) : '';
	if (link && images) images.set(block, link);
	return block;
}

/**
 * One of Notion's blocks in the saved format. With `images`, the images Notion hosts are listed
 * there to download; without, they're `skipped: 'not-downloaded'`.
 */
export function convertBlock(raw: RawBlock, images?: ImageLinks): Block {
	const data = obj(raw[raw.type]);
	const children = raw.children?.map((child) => convertBlock(child, images));
	const nested = children?.length ? { children } : {};
	const text = richText(data.rich_text);
	switch (raw.type) {
		case 'paragraph':
			return { type: 'paragraph', text, ...color(data.color), ...nested };
		case 'heading_1':
		case 'heading_2':
		case 'heading_3':
			return {
				type: 'heading',
				level: Number(raw.type.slice(-1)) as 1 | 2 | 3,
				text,
				...color(data.color),
				...(data.is_toggleable === true ? { toggle: true as const } : {}),
				...nested
			};
		case 'bulleted_list_item':
			return { type: 'bulleted', text, ...color(data.color), ...nested };
		case 'numbered_list_item':
			return { type: 'numbered', text, ...color(data.color), ...nested };
		case 'to_do':
			return {
				type: 'todo',
				text,
				checked: data.checked === true,
				...(raw.id ? { id: raw.id } : {}),
				...color(data.color),
				...nested
			};
		case 'toggle':
			return { type: 'toggle', text, ...color(data.color), ...nested };
		case 'quote':
			return { type: 'quote', text, ...color(data.color), ...nested };
		case 'callout': {
			const icon = emoji(data.icon);
			return {
				type: 'callout',
				text,
				...(icon ? { icon } : {}),
				...color(data.color),
				...nested
			};
		}
		case 'code':
			return {
				type: 'code',
				text,
				language: str(data.language),
				caption: richText(data.caption)
			};
		case 'divider':
			return { type: 'divider' };
		case 'table':
			return {
				type: 'table',
				columnHeader: data.has_column_header === true,
				rowHeader: data.has_row_header === true,
				rows: (raw.children ?? [])
					.filter((row) => row.type === 'table_row')
					.map((row) => list(obj(row.table_row).cells).map(richText))
			};
		case 'child_page':
		case 'child_database':
			return { type: raw.type, id: raw.id, title: str(data.title) };
		case 'link_to_page': {
			const kind = data.type === 'database_id' ? 'database' : 'page';
			const id = strOrNull(data[`${kind}_id`]);
			if (!id) break;
			return { type: 'link_to_page', id, kind };
		}
		case 'bookmark':
		case 'embed':
		case 'link_preview': {
			const url = str(data.url);
			if (!url) break;
			return {
				type: raw.type === 'embed' ? 'embed' : 'bookmark',
				url,
				caption: richText(data.caption)
			};
		}
		case 'equation':
			return { type: 'equation', expression: str(data.expression) };
		case 'column_list':
			return {
				type: 'columns',
				columns: (raw.children ?? [])
					.filter((column) => column.type === 'column')
					.map((column) => (column.children ?? []).map((child) => convertBlock(child, images)))
			};
		case 'image':
			return convertImage(data, images);
		default:
			if (FILES.has(raw.type)) {
				return { type: 'file', notionType: raw.type, caption: richText(data.caption) };
			}
	}
	return { type: 'unsupported', notionType: raw.type };
}

/** A property's value, or `undefined` for types not kept (relations, rollups, files…). */
function convertProperty(name: string, raw: Loose): Property | undefined {
	const type = str(raw.type);
	const value = raw[type];
	switch (type) {
		case 'rich_text':
			return { name, type: 'text', text: richText(value) };
		case 'number':
			return { name, type: 'number', value: typeof value === 'number' ? value : null };
		case 'select':
		case 'status':
			return { name, type: 'select', value: strOrNull(obj(value).name) };
		case 'multi_select':
			return { name, type: 'multi_select', value: list(value).map((o) => str(obj(o).name)) };
		case 'people':
			return {
				name,
				type: 'multi_select',
				value: list(value)
					.map((o) => str(obj(o).name))
					.filter(Boolean)
			};
		case 'date': {
			const date = obj(value);
			return { name, type: 'date', start: strOrNull(date.start), end: strOrNull(date.end) };
		}
		case 'created_time':
		case 'last_edited_time':
			return { name, type: 'date', start: strOrNull(value), end: null };
		case 'checkbox':
			return { name, type: 'checkbox', value: value === true };
		case 'url':
			return { name, type: 'url', value: strOrNull(value) };
		case 'email':
			return { name, type: 'email', value: strOrNull(value) };
		case 'phone_number':
			return { name, type: 'phone', value: strOrNull(value) };
		case 'formula': {
			const result = obj(value);
			const kind = str(result.type);
			if (kind === 'string') return { name, type: 'text', text: textRun(result.string) };
			if (kind === 'number')
				return {
					name,
					type: 'number',
					value: typeof result.number === 'number' ? result.number : null
				};
			if (kind === 'boolean') return { name, type: 'checkbox', value: result.boolean === true };
			if (kind === 'date') {
				const date = obj(result.date);
				return { name, type: 'date', start: strOrNull(date.start), end: strOrNull(date.end) };
			}
			return undefined;
		}
		default:
			return undefined;
	}
}

const textRun = (value: unknown): RichText[] =>
	typeof value === 'string' && value ? [{ text: value }] : [];

/** A page's title: its `title` property's text. */
export function pageTitle(page: RawObject): string {
	for (const raw of Object.values(obj(page.properties))) {
		const property = obj(raw);
		if (property.type === 'title') return plainText(richText(property.title));
	}
	return '';
}

/**
 * A downloaded page and its blocks (from `client.blocks`) in the saved format. `images` collects
 * the images to download (`convertBlock`).
 */
export function toDocument(
	page: RawObject,
	blocks: RawBlock[],
	{
		fetchedAt,
		truncated = false,
		images
	}: { fetchedAt: number; truncated?: boolean; images?: ImageLinks }
): NotionDocument {
	const properties: Property[] = [];
	for (const [name, raw] of Object.entries(obj(page.properties))) {
		const property = obj(raw);
		if (property.type === 'title') continue;
		const converted = convertProperty(name, property);
		if (converted) properties.push(converted);
	}
	return {
		v: DOCUMENT_VERSION,
		id: page.id,
		title: pageTitle(page),
		icon: emoji(page.icon) ?? null,
		url: strOrNull(page.url),
		createdTime: strOrNull(page.created_time),
		properties,
		blocks: blocks.map((block) => convertBlock(block, images)),
		fetchedAt,
		truncated
	};
}
