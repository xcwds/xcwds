/**
 * What `NotionDocument.svelte` needs to draw a saved page (#107), kept out of the components so it
 * can be tested on its own: which links may become an `href`, the classes for Notion's colours and
 * text formatting, heading levels, and list items grouped into lists.
 */
import type { Block, Color, Property, RichText } from './document.js';

/** Link schemes kept; anything else (`javascript:`, `data:`, relative paths) keeps only its text. */
const SCHEMES = new Set(['https:', 'http:', 'mailto:']);

/** `href` when it's an absolute `https:`, `http:` or `mailto:` link, otherwise `undefined`. */
export function safeHref(href: string | null | undefined): string | undefined {
	if (!href) return undefined;
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return undefined;
	}
	return SCHEMES.has(url.protocol) ? url.href : undefined;
}

/** Notion's colours as theme-aware text and background classes. */
const COLORS: Record<string, [text: string, background: string]> = {
	gray: ['text-gray-600 dark:text-gray-400', 'bg-gray-100 dark:bg-gray-800'],
	brown: ['text-amber-800 dark:text-amber-300', 'bg-amber-100 dark:bg-amber-950'],
	orange: ['text-orange-700 dark:text-orange-300', 'bg-orange-100 dark:bg-orange-950'],
	yellow: ['text-yellow-700 dark:text-yellow-300', 'bg-yellow-100 dark:bg-yellow-950'],
	green: ['text-green-700 dark:text-green-300', 'bg-green-100 dark:bg-green-950'],
	blue: ['text-blue-700 dark:text-blue-300', 'bg-blue-100 dark:bg-blue-950'],
	purple: ['text-purple-700 dark:text-purple-300', 'bg-purple-100 dark:bg-purple-950'],
	pink: ['text-pink-700 dark:text-pink-300', 'bg-pink-100 dark:bg-pink-950'],
	red: ['text-red-700 dark:text-red-300', 'bg-red-100 dark:bg-red-950']
};

/** The classes for a Notion colour (`red`, `blue_background`); `''` for `default` or unknown. */
export function colorClass(color: Color | undefined): string {
	if (!color) return '';
	const background = color.endsWith('_background');
	const pair = COLORS[background ? color.slice(0, -'_background'.length) : color];
	return pair ? pair[background ? 1 : 0] : '';
}

/** The classes for a run of text's formatting and colour. */
export function runClass(run: RichText): string {
	const decoration =
		run.strike && run.underline
			? '[text-decoration-line:underline_line-through]'
			: run.strike
				? 'line-through'
				: run.underline
					? 'underline'
					: '';
	return [
		run.bold ? 'font-semibold' : '',
		run.italic ? 'italic' : '',
		decoration,
		run.code ? 'rounded bg-black/5 px-1 font-mono text-[0.9em] dark:bg-white/10' : '',
		colorClass(run.color)
	]
		.filter(Boolean)
		.join(' ');
}

/**
 * The tag for a Notion heading. The shell's header holds the page's `<h1>` and the document's
 * title is an `<h2>`, so Notion's heading 1–3 are `<h3>`–`<h5>`.
 */
export const headingTag = (level: 1 | 2 | 3) => `h${level + 2}` as const satisfies string;

/** A block as drawn: on its own, or consecutive list items in one `<ul>` or `<ol>`. */
export type Group =
	| { kind: 'block'; block: Block }
	| { kind: 'list'; ordered: boolean; items: Extract<Block, { type: 'bulleted' | 'numbered' }>[] };

/** Groups consecutive bulleted (or numbered) items into lists; other blocks stay as they are. */
export function groupBlocks(blocks: readonly Block[]): Group[] {
	const groups: Group[] = [];
	for (const block of blocks) {
		if (block.type === 'bulleted' || block.type === 'numbered') {
			const ordered = block.type === 'numbered';
			const last = groups.at(-1);
			if (last?.kind === 'list' && last.ordered === ordered) last.items.push(block);
			else groups.push({ kind: 'list', ordered, items: [block] });
		} else groups.push({ kind: 'block', block });
	}
	return groups;
}

/** A property's value as plain text (`''` when it has none); text properties keep their runs. */
export function propertyText(property: Property): string {
	switch (property.type) {
		case 'text':
			return property.text.map((run) => run.text).join('');
		case 'number':
			return property.value === null ? '' : String(property.value);
		case 'select':
			return property.value ?? '';
		case 'multi_select':
			return property.value.join(', ');
		case 'date':
			return [property.start, property.end].filter(Boolean).join(' – ');
		case 'checkbox':
			return property.value ? 'Yes' : 'No';
		case 'url':
		case 'email':
		case 'phone':
			return property.value ?? '';
	}
}

/** The link a property's value gets, if any: a safe URL, or `mailto:` for an email. */
export function propertyHref(property: Property): string | undefined {
	if (property.type === 'url') return safeHref(property.value);
	if (property.type === 'email' && property.value && !/[\s:/?#]/.test(property.value))
		return safeHref(`mailto:${property.value}`);
	return undefined;
}

/** What a placeholder calls an image, file, video or other block not drawn here. */
export function fileLabel(notionType: string): string {
	switch (notionType) {
		case 'image':
			return 'Image';
		case 'video':
			return 'Video';
		case 'audio':
			return 'Audio';
		case 'pdf':
			return 'PDF';
		default:
			return 'File';
	}
}
