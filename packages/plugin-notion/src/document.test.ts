import { describe, expect, it } from 'vitest';
import type { RawBlock, RawObject } from './api.js';
import {
	DOCUMENT_VERSION,
	convertBlock,
	pageTitle,
	richText,
	toDocument,
	type Block,
	type ImageLinks
} from './document.js';

/** Notion's rich text item. */
const rt = (
	plain_text: string,
	annotations: Record<string, unknown> = {},
	href: string | null = null
) => ({
	type: 'text',
	plain_text,
	href,
	annotations: {
		bold: false,
		italic: false,
		strikethrough: false,
		underline: false,
		code: false,
		color: 'default',
		...annotations
	}
});

const raw = (type: string, data: Record<string, unknown>, children?: RawBlock[]): RawBlock => ({
	id: `${type}-id`,
	type,
	has_children: !!children,
	[type]: data,
	...(children ? { children } : {})
});

describe('rich text', () => {
	it('keeps the text, the annotations that are on, colours and links', () => {
		expect(
			richText([
				rt('plain '),
				rt('all', { bold: true, italic: true, strikethrough: true, underline: true, code: true }),
				rt('red', { color: 'red_background' }),
				rt('link', {}, 'https://example.com/'),
				{ type: 'mention', plain_text: '@Alex', href: null, annotations: {} },
				{ type: 'equation', plain_text: 'x^2', annotations: { code: false } },
				rt(''),
				'junk',
				null
			])
		).toEqual([
			{ text: 'plain ' },
			{ text: 'all', bold: true, italic: true, strike: true, underline: true, code: true },
			{ text: 'red', color: 'red_background' },
			{ text: 'link', href: 'https://example.com/' },
			{ text: '@Alex' },
			{ text: 'x^2' }
		]);
		expect(richText(undefined)).toEqual([]);
	});
});

describe('blocks', () => {
	const text = [rt('Hi')];
	const runs = [{ text: 'Hi' }];

	it('converts each text block, with colour and children', () => {
		const child = raw('paragraph', { rich_text: [rt('child')] });
		expect(convertBlock(raw('paragraph', { rich_text: text, color: 'blue' }, [child]))).toEqual({
			type: 'paragraph',
			text: runs,
			color: 'blue',
			children: [{ type: 'paragraph', text: [{ text: 'child' }] }]
		});
		expect(convertBlock(raw('heading_2', { rich_text: text, is_toggleable: true }))).toEqual({
			type: 'heading',
			level: 2,
			text: runs,
			toggle: true
		});
		expect(convertBlock(raw('heading_3', { rich_text: text, color: 'default' }))).toEqual({
			type: 'heading',
			level: 3,
			text: runs
		});
		for (const [notion, type] of [
			['bulleted_list_item', 'bulleted'],
			['numbered_list_item', 'numbered'],
			['toggle', 'toggle'],
			['quote', 'quote']
		] as const) {
			expect(convertBlock(raw(notion, { rich_text: text }))).toEqual({ type, text: runs });
		}
		expect(convertBlock(raw('to_do', { rich_text: text, checked: true }))).toEqual({
			type: 'todo',
			text: runs,
			checked: true,
			id: 'to_do-id'
		});
		expect(convertBlock(raw('to_do', { rich_text: text }))).toMatchObject({ checked: false });
		expect(
			convertBlock(raw('callout', { rich_text: text, icon: { type: 'emoji', emoji: '💡' } }))
		).toEqual({ type: 'callout', text: runs, icon: '💡' });
		expect(
			convertBlock(raw('callout', { rich_text: text, icon: { type: 'external', external: {} } }))
		).toEqual({ type: 'callout', text: runs });
	});

	it('nests lists as deep as they were fetched', () => {
		const deep = raw('bulleted_list_item', { rich_text: [rt('a')] }, [
			raw('bulleted_list_item', { rich_text: [rt('b')] }, [
				raw('numbered_list_item', { rich_text: [rt('c')] })
			])
		]);
		expect(convertBlock(deep)).toEqual({
			type: 'bulleted',
			text: [{ text: 'a' }],
			children: [
				{
					type: 'bulleted',
					text: [{ text: 'b' }],
					children: [{ type: 'numbered', text: [{ text: 'c' }] }]
				}
			]
		});
	});

	it('converts code, dividers, tables, links to pages, bookmarks, equations and columns', () => {
		expect(
			convertBlock(raw('code', { rich_text: [rt('let x;')], language: 'javascript', caption: [] }))
		).toEqual({ type: 'code', text: [{ text: 'let x;' }], language: 'javascript', caption: [] });
		expect(convertBlock(raw('divider', {}))).toEqual({ type: 'divider' });
		const row = (a: string, b: string) => raw('table_row', { cells: [[rt(a)], [rt(b)]] });
		expect(
			convertBlock(
				raw('table', { table_width: 2, has_column_header: true, has_row_header: false }, [
					row('Day', 'Plan'),
					row('Mon', 'Gym')
				])
			)
		).toEqual({
			type: 'table',
			columnHeader: true,
			rowHeader: false,
			rows: [
				[[{ text: 'Day' }], [{ text: 'Plan' }]],
				[[{ text: 'Mon' }], [{ text: 'Gym' }]]
			]
		});
		expect(convertBlock(raw('child_page', { title: 'Notes' }))).toEqual({
			type: 'child_page',
			id: 'child_page-id',
			title: 'Notes'
		});
		expect(convertBlock(raw('link_to_page', { type: 'database_id', database_id: 'd1' }))).toEqual({
			type: 'link_to_page',
			id: 'd1',
			kind: 'database'
		});
		expect(convertBlock(raw('link_to_page', { type: 'page_id', page_id: 'p1' }))).toEqual({
			type: 'link_to_page',
			id: 'p1',
			kind: 'page'
		});
		expect(
			convertBlock(raw('bookmark', { url: 'https://example.com', caption: [rt('c')] }))
		).toEqual({ type: 'bookmark', url: 'https://example.com', caption: [{ text: 'c' }] });
		expect(convertBlock(raw('embed', { url: 'https://example.com/e' }))).toEqual({
			type: 'embed',
			url: 'https://example.com/e',
			caption: []
		});
		expect(convertBlock(raw('equation', { expression: 'e=mc^2' }))).toEqual({
			type: 'equation',
			expression: 'e=mc^2'
		});
		const column = (t: string) => raw('column', {}, [raw('paragraph', { rich_text: [rt(t)] })]);
		expect(convertBlock(raw('column_list', {}, [column('left'), column('right')]))).toEqual({
			type: 'columns',
			columns: [
				[{ type: 'paragraph', text: [{ text: 'left' }] }],
				[{ type: 'paragraph', text: [{ text: 'right' }] }]
			]
		});
	});

	it('lists the images Notion hosts to download, and keeps links to the others (#108)', () => {
		const hosted = raw('image', {
			type: 'file',
			file: { url: 'https://s3.example/x.png?sig=1', expiry_time: '2026-10-22T07:00:00.000Z' },
			caption: [rt('Cat')]
		});
		// Without a list to download into, it isn't downloaded, and the link is never kept.
		expect(convertBlock(hosted)).toEqual({
			type: 'image',
			caption: [{ text: 'Cat' }],
			skipped: 'not-downloaded'
		});
		const images: ImageLinks = new Map();
		const nested = convertBlock(raw('toggle', { rich_text: [rt('Photos')] }, [hosted]), images);
		const block = (nested as { children: Block[] }).children[0]!;
		expect([...images]).toEqual([[block, 'https://s3.example/x.png?sig=1']]);
		expect(JSON.stringify(nested)).not.toContain('sig=1');

		expect(
			convertBlock(
				raw('image', { type: 'external', external: { url: 'https://a.example/i.png' } }),
				images
			)
		).toEqual({ type: 'image', caption: [], external: 'https://a.example/i.png' });
		// Uploaded through the API, or missing its link: nothing to download.
		for (const data of [{ type: 'file_upload', file_upload: { id: 'u' } }, { type: 'file' }])
			expect(convertBlock(raw('image', data), images)).toEqual({
				type: 'image',
				caption: [],
				skipped: 'not-downloaded'
			});
		expect(images.size).toBe(1);
	});

	it('keeps files as placeholders and marks anything else unsupported', () => {
		expect(
			convertBlock(
				raw('pdf', { type: 'file', file: { url: 'https://s3/x' }, caption: [rt('Cat')] })
			)
		).toEqual({ type: 'file', notionType: 'pdf', caption: [{ text: 'Cat' }] });
		for (const type of ['synced_block', 'table_of_contents', 'breadcrumb', 'made_up']) {
			expect(convertBlock(raw(type, {}))).toEqual({ type: 'unsupported', notionType: type });
		}
		// Missing what it needs: unsupported, not broken.
		expect(convertBlock(raw('bookmark', {}))).toEqual({
			type: 'unsupported',
			notionType: 'bookmark'
		});
		expect(convertBlock({ id: 'x', type: 'paragraph' })).toEqual({ type: 'paragraph', text: [] });
	});
});

describe('toDocument', () => {
	const page: RawObject = {
		object: 'page',
		id: 'p1',
		url: 'https://www.notion.so/Agenda-p1',
		created_time: '2026-10-22T06:00:00.000Z',
		icon: { type: 'emoji', emoji: '📅' },
		properties: {
			Notes: { type: 'rich_text', rich_text: [rt('Busy', { bold: true })] },
			Name: { type: 'title', title: [rt('Agenda, '), rt('Thursday')] },
			Count: { type: 'number', number: 3 },
			Stage: { type: 'status', status: { name: 'Done' } },
			Kind: { type: 'select', select: null },
			Tags: { type: 'multi_select', multi_select: [{ name: 'home' }, { name: 'work' }] },
			Owner: { type: 'people', people: [{ name: 'Sam' }, { id: 'no-name' }] },
			Date: { type: 'date', date: { start: '2026-10-22', end: null } },
			Created: { type: 'created_time', created_time: '2026-10-22T06:00:00.000Z' },
			Done: { type: 'checkbox', checkbox: true },
			Link: { type: 'url', url: 'https://example.com' },
			Mail: { type: 'email', email: null },
			Phone: { type: 'phone_number', phone_number: '555' },
			Score: { type: 'formula', formula: { type: 'number', number: 7 } },
			Label: { type: 'formula', formula: { type: 'string', string: 'hi' } },
			Related: { type: 'relation', relation: [{ id: 'x' }] },
			Files: { type: 'files', files: [] }
		}
	};

	it('keeps the title, icon, link, date, properties and blocks, versioned', () => {
		const document = toDocument(page, [raw('divider', {})], { fetchedAt: 42, truncated: true });
		expect(document).toEqual({
			v: DOCUMENT_VERSION,
			id: 'p1',
			title: 'Agenda, Thursday',
			icon: '📅',
			url: 'https://www.notion.so/Agenda-p1',
			createdTime: '2026-10-22T06:00:00.000Z',
			properties: [
				{ name: 'Notes', type: 'text', text: [{ text: 'Busy', bold: true }] },
				{ name: 'Count', type: 'number', value: 3 },
				{ name: 'Stage', type: 'select', value: 'Done' },
				{ name: 'Kind', type: 'select', value: null },
				{ name: 'Tags', type: 'multi_select', value: ['home', 'work'] },
				{ name: 'Owner', type: 'multi_select', value: ['Sam'] },
				{ name: 'Date', type: 'date', start: '2026-10-22', end: null },
				{ name: 'Created', type: 'date', start: '2026-10-22T06:00:00.000Z', end: null },
				{ name: 'Done', type: 'checkbox', value: true },
				{ name: 'Link', type: 'url', value: 'https://example.com' },
				{ name: 'Mail', type: 'email', value: null },
				{ name: 'Phone', type: 'phone', value: '555' },
				{ name: 'Score', type: 'number', value: 7 },
				{ name: 'Label', type: 'text', text: [{ text: 'hi' }] }
			],
			blocks: [{ type: 'divider' }],
			fetchedAt: 42,
			truncated: true
		});
		// Plain JSON, so it saves as it is.
		expect(JSON.parse(JSON.stringify(document))).toEqual(document);
	});

	it('copes with a page that has little of that', () => {
		expect(toDocument({ object: 'page', id: 'p2' }, [], { fetchedAt: 1 })).toEqual({
			v: DOCUMENT_VERSION,
			id: 'p2',
			title: '',
			icon: null,
			url: null,
			createdTime: null,
			properties: [],
			blocks: [],
			fetchedAt: 1,
			truncated: false
		});
		expect(pageTitle(page)).toBe('Agenda, Thursday');
	});
});
