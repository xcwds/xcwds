import { describe, expect, it } from 'vitest';
import type { Block } from './document.js';
import {
	colorClass,
	fileLabel,
	groupBlocks,
	headingTag,
	propertyHref,
	propertyText,
	runClass,
	safeHref
} from './render.js';

describe('safeHref', () => {
	it('keeps https, http and mailto links and drops everything else', () => {
		expect(safeHref('https://example.com/a?b#c')).toBe('https://example.com/a?b#c');
		expect(safeHref('http://example.com')).toBe('http://example.com/');
		expect(safeHref('mailto:me@example.com')).toBe('mailto:me@example.com');
		for (const bad of [
			'javascript:alert(1)',
			' JavaScript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'vbscript:x',
			'/relative/path',
			'//example.com',
			'notion://www.notion.so/x',
			'',
			null,
			undefined
		])
			expect(safeHref(bad), String(bad)).toBeUndefined();
	});
});

describe('classes', () => {
	it('maps Notion colours to theme-aware text and background classes', () => {
		expect(colorClass('red')).toBe('text-red-700 dark:text-red-300');
		expect(colorClass('blue_background')).toBe('bg-blue-100 dark:bg-blue-950');
		expect(colorClass('default')).toBe('');
		expect(colorClass('mauve')).toBe('');
		expect(colorClass(undefined)).toBe('');
	});

	it('formats runs, with strikethrough and underline together', () => {
		expect(runClass({ text: 'x' })).toBe('');
		expect(runClass({ text: 'x', bold: true, italic: true })).toBe('font-semibold italic');
		expect(runClass({ text: 'x', strike: true })).toBe('line-through');
		expect(runClass({ text: 'x', underline: true })).toBe('underline');
		expect(runClass({ text: 'x', strike: true, underline: true })).toBe(
			'[text-decoration-line:underline_line-through]'
		);
		expect(runClass({ text: 'x', code: true, color: 'green' })).toContain('font-mono');
		expect(runClass({ text: 'x', code: true, color: 'green' })).toContain('text-green-700');
	});

	it('puts Notion’s headings under the document’s h2', () => {
		expect([1, 2, 3].map((level) => headingTag(level as 1 | 2 | 3))).toEqual(['h3', 'h4', 'h5']);
	});
});

describe('groupBlocks', () => {
	const item = (type: 'bulleted' | 'numbered', text: string): Block => ({
		type,
		text: [{ text }]
	});

	it('groups consecutive items of one kind into a list', () => {
		const groups = groupBlocks([
			item('bulleted', 'a'),
			item('bulleted', 'b'),
			item('numbered', '1'),
			{ type: 'divider' },
			item('bulleted', 'c')
		]);
		expect(
			groups.map((g) => (g.kind === 'list' ? [g.ordered, g.items.length] : g.block.type))
		).toEqual([[false, 2], [true, 1], 'divider', [false, 1]]);
		expect(groupBlocks([])).toEqual([]);
	});
});

describe('properties', () => {
	it('reads each kind of property as text', () => {
		expect(propertyText({ name: 'N', type: 'text', text: [{ text: 'a' }, { text: 'b' }] })).toBe(
			'ab'
		);
		expect(propertyText({ name: 'N', type: 'number', value: 0 })).toBe('0');
		expect(propertyText({ name: 'N', type: 'number', value: null })).toBe('');
		expect(propertyText({ name: 'N', type: 'select', value: 'High' })).toBe('High');
		expect(propertyText({ name: 'N', type: 'multi_select', value: ['a', 'b'] })).toBe('a, b');
		expect(propertyText({ name: 'N', type: 'date', start: '2026-10-23', end: null })).toBe(
			'2026-10-23'
		);
		expect(propertyText({ name: 'N', type: 'date', start: '2026-10-23', end: '2026-10-24' })).toBe(
			'2026-10-23 – 2026-10-24'
		);
		expect(propertyText({ name: 'N', type: 'checkbox', value: false })).toBe('No');
		expect(propertyText({ name: 'N', type: 'phone', value: '555' })).toBe('555');
	});

	it('links only safe URLs and plain email addresses', () => {
		expect(propertyHref({ name: 'N', type: 'url', value: 'https://a.example' })).toBe(
			'https://a.example/'
		);
		expect(propertyHref({ name: 'N', type: 'url', value: 'javascript:alert(1)' })).toBeUndefined();
		expect(propertyHref({ name: 'N', type: 'email', value: 'me@a.example' })).toBe(
			'mailto:me@a.example'
		);
		expect(
			propertyHref({ name: 'N', type: 'email', value: 'me@a.example?body=x' })
		).toBeUndefined();
		expect(propertyHref({ name: 'N', type: 'phone', value: '555' })).toBeUndefined();
	});

	it('names file placeholders', () => {
		expect(['image', 'video', 'audio', 'pdf', 'file', 'other'].map(fileLabel)).toEqual([
			'Image',
			'Video',
			'Audio',
			'PDF',
			'File',
			'File'
		]);
	});
});
