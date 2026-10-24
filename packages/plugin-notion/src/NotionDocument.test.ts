// Renders `NotionDocument.svelte` on the server (`svelte/server`) and checks the HTML it writes.
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import NotionDocument from './NotionDocument.svelte';
import { DOCUMENT_VERSION, type Block, type NotionDocument as Doc } from './document.js';

const doc = (blocks: Block[], extra: Partial<Doc> = {}): Doc => ({
	v: DOCUMENT_VERSION,
	id: 'p',
	title: 'Agenda',
	icon: '📅',
	url: 'https://www.notion.so/Agenda-p',
	createdTime: null,
	properties: [],
	blocks,
	fetchedAt: 0,
	truncated: false,
	...extra
});

/** The component's HTML, without Svelte's hydration comments. */
const html = (document: Doc) =>
	render(NotionDocument, { props: { document } }).body.replace(/<!--[^]*?-->/g, '');

const t = (text: string) => [{ text }];

describe('NotionDocument', () => {
	it('titles the page with an h2 and lists its properties', () => {
		const out = html(
			doc([], {
				properties: [
					{ name: 'Date', type: 'date', start: '2026-10-23', end: null },
					{ name: 'Empty', type: 'select', value: null },
					{ name: 'Done', type: 'checkbox', value: false },
					{ name: 'Site', type: 'url', value: 'https://a.example' }
				]
			})
		);
		expect(out).toMatch(/<h2[^>]*>\s*<span aria-hidden="true">📅<\/span>\s*Agenda\s*<\/h2>/);
		expect(out).not.toContain('<h1');
		expect(out).toMatch(/<dt[^>]*>Date<\/dt>\s*<dd[^>]*>2026-10-23<\/dd>/);
		expect(out).not.toContain('Empty');
		expect(out).toMatch(/<dt[^>]*>Done<\/dt>\s*<dd[^>]*>No<\/dd>/);
		expect(out).toContain('href="https://a.example/"');
	});

	it('draws each kind of block', () => {
		const out = html(
			doc([
				{ type: 'heading', level: 1, text: t('One') },
				{ type: 'heading', level: 3, text: t('Three') },
				{
					type: 'heading',
					level: 2,
					text: t('Folded'),
					toggle: true,
					children: [{ type: 'paragraph', text: t('Inside') }]
				},
				{ type: 'paragraph', text: t('Hello'), color: 'red' },
				{ type: 'bulleted', text: t('a'), children: [{ type: 'bulleted', text: t('a.1') }] },
				{ type: 'bulleted', text: t('b') },
				{ type: 'numbered', text: t('first') },
				{ type: 'todo', text: t('Done thing'), checked: true },
				{ type: 'todo', text: t('Open thing'), checked: false },
				{ type: 'toggle', text: t('More'), children: [{ type: 'paragraph', text: t('Hidden') }] },
				{ type: 'quote', text: t('Said') },
				{ type: 'callout', text: t('Note'), icon: '💡' },
				{ type: 'code', text: t('let x = "<b>";'), language: 'js', caption: [] },
				{ type: 'divider' },
				{
					type: 'table',
					columnHeader: true,
					rowHeader: true,
					rows: [
						[t('Day'), t('Plan')],
						[t('Mon'), t('Rest')]
					]
				},
				{ type: 'child_page', id: 'c', title: 'Sub page' },
				{ type: 'link_to_page', id: 'l', kind: 'database' },
				{ type: 'bookmark', url: 'https://b.example', caption: [] },
				{ type: 'equation', expression: 'e = mc^2' },
				{
					type: 'columns',
					columns: [
						[{ type: 'paragraph', text: t('Left') }],
						[{ type: 'paragraph', text: t('Right') }]
					]
				},
				{ type: 'file', notionType: 'image', caption: t('A photo') },
				{ type: 'unsupported', notionType: 'synced_block' }
			])
		);
		expect(out).toMatch(/<h3[^>]*>One<\/h3>/);
		expect(out).toMatch(/<h5[^>]*>Three<\/h5>/);
		expect(out).toMatch(
			/<details><summary[^>]*><h4[^>]*>Folded<\/h4><\/summary>[^]*Inside[^]*<\/details>/
		);
		expect(out).toMatch(/<p class="text-red-700 dark:text-red-300">Hello<\/p>/);
		// One list for a and b, with a.1 nested inside a; the numbered item in its own list.
		expect(out).toMatch(
			/<ul[^>]*><li[^>]*>a<div[^>]*><ul[^>]*><li[^>]*>a\.1<\/li><\/ul><\/div><\/li>\s*<li[^>]*>b<\/li><\/ul>/
		);
		expect(out).toMatch(/<ol[^>]*><li[^>]*>first<\/li><\/ol>/);
		expect(out).toMatch(/<input type="checkbox"[^>]*checked[^>]*disabled[^>]*\/?>[^]*?Done thing/);
		expect(out).toMatch(/<input type="checkbox" class="[^"]*" disabled[^>]*\/?>[^]*?Open thing/);
		expect(out).toMatch(/<details[^>]*><summary[^>]*>More<\/summary>[^]*Hidden[^]*<\/details>/);
		expect(out).toMatch(/<blockquote[^>]*>[^]*Said[^]*<\/blockquote>/);
		expect(out).toMatch(/<aside[^>]*><span aria-hidden="true">💡<\/span>[^]*Note/);
		expect(out).toContain('<code>let x = "&lt;b>";</code></pre>');
		expect(out).toContain('<hr');
		expect(out).toMatch(
			/<thead><tr><th scope="col"[^>]*>Day<\/th><th scope="col"[^>]*>Plan<\/th><\/tr><\/thead>/
		);
		expect(out).toMatch(
			/<tbody><tr><th scope="row"[^>]*>Mon<\/th><td[^>]*>Rest<\/td><\/tr><\/tbody>/
		);
		expect(out).toContain('Sub page');
		expect(out).toContain('Linked database');
		expect(out).toMatch(
			/<a href="https:\/\/b\.example\/" target="_blank" rel="noopener noreferrer"[^>]*>https:\/\/b\.example<\/a>/
		);
		expect(out).toContain('<code class="font-mono">e = mc^2</code>');
		expect(out).toMatch(/Left[^]*Right/);
		expect(out).toMatch(
			/data-notion="file"[^>]*>\s*Image not shown here yet\.[^]*A photo[^]*Open in Notion/
		);
		expect(out).toMatch(
			/data-notion="unsupported"[^>]*>\s*Not shown here\.[^]*href="https:\/\/www\.notion\.so\/Agenda-p"[^]*Open in Notion/
		);
	});

	it('draws images: saved ones once read, links for others, and why the rest are missing (#108)', () => {
		const out = html(
			doc([
				{ type: 'image', caption: t('The cat'), file: 'blob-1' },
				{ type: 'image', caption: [], external: 'https://a.example/i.png' },
				{ type: 'image', caption: [], external: 'javascript:alert(1)' },
				{ type: 'image', caption: [], skipped: 'too-large' },
				{ type: 'image', caption: [], skipped: 'not-downloaded' }
			])
		);
		// A saved image is read on the device after the page starts, so the server draws none, and
		// no image is ever loaded from another site.
		expect(out).not.toContain('<img');
		expect(out).toMatch(/<figcaption[^>]*>\s*The cat\s*<\/figcaption>/);
		expect(out).toMatch(
			/data-notion="image-external"[^>]*>\s*Image from another site, not loaded here:\s*<a href="https:\/\/a\.example\/i\.png"[^>]*rel="noopener noreferrer"[^>]*>Open it on a\.example<\/a>/
		);
		expect(out).not.toContain('javascript:');
		expect(out).toMatch(
			/data-notion="image-skipped"[^>]*>\s*Image not saved on this device: it’s over 5 MB\./
		);
		expect(out).toMatch(/data-notion="image-skipped"[^>]*>\s*Image not shown here\./);
		expect(out.match(/data-notion="image-skipped"/g)).toHaveLength(3);
	});

	it('formats rich text and links only safe schemes', () => {
		const out = html(
			doc([
				{
					type: 'paragraph',
					text: [
						{ text: 'bold', bold: true },
						{ text: 'both', strike: true, underline: true },
						{ text: 'fn()', code: true },
						{ text: 'safe', href: 'https://ok.example/x' },
						{ text: 'gone', href: 'https://ok.example/y', strike: true },
						{ text: 'evil', href: 'javascript:alert(1)' },
						{ text: 'data', href: 'data:text/html,hi' },
						{ text: '<img src=x onerror=alert(1)>' }
					]
				}
			])
		);
		expect(out).toContain('<span class="font-semibold">bold</span>');
		expect(out).toContain('[text-decoration-line:underline_line-through]');
		expect(out).toMatch(/<code class="[^"]*font-mono[^"]*">fn\(\)<\/code>/);
		expect(out).toContain(
			'<a href="https://ok.example/x" target="_blank" rel="noopener noreferrer" class="underline-offset-2 underline">safe</a>'
		);
		// A struck-through link keeps both lines.
		expect(out).toMatch(
			/<a href="https:\/\/ok\.example\/y"[^>]*class="underline-offset-2 \[text-decoration-line:underline_line-through\]">gone<\/a>/
		);
		// Unsafe links keep their text, with no link.
		expect(out).toMatch(/>gone<\/a>evildata/);
		expect(out).not.toContain('javascript:');
		expect(out).not.toContain('data:text');
		// Text is text, never markup.
		expect(out).toContain('&lt;img src=x onerror=alert(1)>');
		expect(out).not.toContain('<img');
	});

	it('drops an unsafe page link, and says when the page was cut short', () => {
		const out = html(
			doc([{ type: 'unsupported', notionType: 'x' }], {
				url: 'javascript:alert(1)',
				truncated: true,
				icon: null,
				title: ''
			})
		);
		expect(out).toMatch(/<h2[^>]*>\s*Untitled\s*<\/h2>/);
		expect(out).not.toContain('javascript:');
		expect(out).not.toContain('Open in Notion');
		expect(out).toContain('data-notion="truncated"');
	});
});
