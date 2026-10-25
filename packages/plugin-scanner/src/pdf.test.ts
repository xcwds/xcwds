import { describe, expect, it } from 'vitest';
import { PAPER } from './geometry.js';
import { PAGE_SIZES, jpegInfo, stripJpeg, writePdf } from './pdf.js';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const segment = (marker: number, body: number[]) => [
	0xff,
	marker,
	(body.length + 2) >> 8,
	(body.length + 2) & 0xff,
	...body
];

/** A JPEG's structure (not a decodable image): the segments a canvas or a camera writes. */
function jpeg(
	width: number,
	height: number,
	{ components = 3, sof = 0xc0, metadata = false, progressive = false, trailer = false } = {}
): Uint8Array {
	return new Uint8Array([
		0xff,
		0xd8,
		...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
		...(metadata
			? [
					...segment(0xe1, [...ascii('Exif'), 0, 0, ...ascii('GPS 51.5N Pixel 9 2026:10:25')]),
					...segment(0xe2, ascii('ICC_PROFILE Pixel 9 display')),
					...segment(0xfe, ascii('taken by Sam'))
				]
			: []),
		...segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1]),
		...segment(0xdb, [0, ...Array(64).fill(1)]),
		...segment(0xc4, [0, ...Array(16).fill(0)]),
		...segment(sof, [
			8,
			height >> 8,
			height & 0xff,
			width >> 8,
			width & 0xff,
			components,
			...Array(components * 3).fill(1)
		]),
		...segment(0xda, [1, 1, 0, 0, 63, 0]),
		0x12,
		0x34,
		0xff,
		0x00,
		0xff,
		0xd0,
		0x56,
		// A progressive JPEG's next scan, with metadata between the two.
		...(progressive
			? [
					...(metadata ? segment(0xe1, [...ascii('Exif'), 0, 0, ...ascii('GPS 48.8N')]) : []),
					...segment(0xc4, [0x10, ...Array(16).fill(0)]),
					...segment(0xda, [1, 1, 0, 1, 63, 0x11]),
					0x78,
					0xff,
					0x00,
					0x9a
				]
			: []),
		0xff,
		0xd9,
		// What phones append after the image: a Motion Photo's video, Samsung's trailer.
		...(trailer ? [0, 0, 0, 0x18, ...ascii('ftypmp42 MotionPhoto_Data SEFT')] : [])
	]);
}

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/**
 * Reads a PDF the way a viewer starts to: `startxref`, the cross-reference table, the trailer,
 * then every object at its offset. Fails the test on anything out of place.
 */
function parse(bytes: Uint8Array) {
	const text = latin1(bytes);
	expect(text.startsWith('%PDF-1.4\n%')).toBe(true);
	expect([...bytes.subarray(10, 14)].every((b) => b > 127)).toBe(true);
	expect(text.endsWith('%%EOF\n')).toBe(true);
	const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
	expect(text.slice(xref, xref + 5)).toBe('xref\n');
	const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(xref))!.map(Number) as number[];
	expect(first).toBe(0);
	const entries = text
		.slice(xref)
		.split('\n')
		.slice(2, 2 + count!);
	expect(entries[0]).toBe('0000000000 65535 f ');
	const trailer = /trailer\n<<(.*)>>\nstartxref/.exec(text)![1]!;
	expect(trailer.trim()).toBe(`/Size ${count} /Root 1 0 R`);
	const objects = new Map<number, { dict: string; stream?: Uint8Array }>();
	entries.slice(1).forEach((entry, n) => {
		const id = n + 1;
		expect(entry).toMatch(/^\d{10} 00000 n $/);
		expect(entry.length + 1).toBe(20);
		const offset = Number(entry.slice(0, 10));
		const head = `${id} 0 obj\n`;
		expect(text.slice(offset, offset + head.length)).toBe(head);
		const start = offset + head.length;
		const dictEnd = text.indexOf('\n', start);
		const dict = text.slice(start, dictEnd);
		const object: { dict: string; stream?: Uint8Array } = { dict };
		if (text.startsWith('stream\n', dictEnd + 1)) {
			const length = Number(/\/Length (\d+)/.exec(dict)![1]);
			const from = dictEnd + 1 + 'stream\n'.length;
			object.stream = bytes.subarray(from, from + length);
			expect(text.slice(from + length, from + length + 18)).toBe('\nendstream\nendobj\n');
		} else expect(text.slice(dictEnd, dictEnd + 8)).toBe('\nendobj\n');
		objects.set(id, object);
	});
	const ref = (dict: string, key: string) =>
		Number(new RegExp(`/${key} (\\d+) 0 R`).exec(dict)![1]);
	const catalog = objects.get(ref(trailer, 'Root'))!;
	expect(catalog.dict).toContain('/Type /Catalog');
	const tree = objects.get(ref(catalog.dict, 'Pages'))!;
	const kids = [.../\/Kids \[([^\]]*)\]/.exec(tree.dict)![1]!.matchAll(/(\d+) 0 R/g)].map((m) =>
		Number(m[1])
	);
	expect(tree.dict).toContain(`/Count ${kids.length}`);
	const pages = kids.map((id) => {
		const page = objects.get(id)!;
		expect(page.dict).toContain('/Type /Page ');
		expect(page.dict).toContain('/Parent 2 0 R');
		const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(page.dict)!.slice(1).map(Number);
		const content = latin1(objects.get(ref(page.dict, 'Contents'))!.stream!);
		const image = objects.get(ref(page.dict, 'Im0'))!;
		expect(image.dict).toMatch(/\/Subtype \/Image .*\/Filter \/DCTDecode/);
		return { box, content, image };
	});
	return { text, pages };
}

describe('jpegInfo', () => {
	it('reads the size and components from the frame header, past other segments', () => {
		expect(jpegInfo(jpeg(2480, 3508))).toEqual({ width: 2480, height: 3508, components: 3 });
		expect(jpegInfo(jpeg(10, 20, { components: 1, sof: 0xc2, metadata: true }))).toEqual({
			width: 10,
			height: 20,
			components: 1
		});
	});

	it('refuses what isn’t a JPEG it can embed', () => {
		expect(jpegInfo(new Uint8Array(ascii('%PDF-1.4')))).toBeNull();
		expect(jpegInfo(jpeg(10, 10, { components: 4 }))).toBeNull(); // CMYK
		expect(jpegInfo(jpeg(10, 10).subarray(0, 30))).toBeNull(); // cut short
		expect(jpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
	});
});

describe('stripJpeg', () => {
	it('drops EXIF, ICC and comments and keeps JFIF, Adobe and the image data as they are', () => {
		const clean = stripJpeg(jpeg(10, 10, { metadata: true }))!;
		expect(clean).toEqual(jpeg(10, 10));
		const text = latin1(clean);
		for (const word of ['Exif', 'GPS', 'Pixel', 'ICC', 'Sam']) expect(text).not.toContain(word);
		expect(text).toContain('JFIF');
		expect(text).toContain('Adobe');
	});

	it('drops metadata between a progressive JPEG’s scans and keeps the scans whole', () => {
		const clean = stripJpeg(jpeg(10, 10, { progressive: true, metadata: true }))!;
		expect(clean).toEqual(jpeg(10, 10, { progressive: true }));
		expect(latin1(clean)).not.toContain('GPS');
	});

	it('ends at the end of the image, dropping a Motion Photo’s video or a trailer after it', () => {
		const clean = stripJpeg(jpeg(10, 10, { trailer: true, metadata: true }))!;
		expect(clean).toEqual(jpeg(10, 10));
		for (const word of ['ftyp', 'MotionPhoto', 'SEFT']) expect(latin1(clean)).not.toContain(word);
	});

	it('refuses broken files', () => {
		expect(stripJpeg(new Uint8Array([1, 2, 3]))).toBeNull();
		expect(stripJpeg(jpeg(10, 10).subarray(0, 40))).toBeNull();
		const whole = jpeg(10, 10);
		expect(stripJpeg(whole.subarray(0, whole.length - 2))).toBeNull(); // no end of image
		expect(stripJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull(); // no scan
	});
});

describe('writePdf', () => {
	it('writes a file a reader can walk, one page per image, in order', () => {
		const a = jpeg(2480, 3508);
		const b = jpeg(1000, 1000, { components: 1 });
		const { pages } = parse(writePdf([a, b]));
		expect(pages).toHaveLength(2);
		expect(pages[0]!.image.stream).toEqual(a);
		expect(pages[0]!.image.dict).toContain('/Width 2480 /Height 3508 /ColorSpace /DeviceRGB');
		expect(pages[1]!.image.stream).toEqual(b);
		expect(pages[1]!.image.dict).toContain('/ColorSpace /DeviceGray');
	});

	it('fits each image on A4 or Letter, centred, landscape when the image is', () => {
		const { pages } = parse(writePdf([jpeg(2480, 3508), jpeg(2000, 1000), jpeg(1000, 1000)]));
		expect(pages[0]!.box).toEqual([595.28, 841.89]);
		// 2480 × 3508 is a hair narrower than A4, so it's as tall as the page and centred across.
		expect(pages[0]!.content).toBe('q 595.18 0 0 841.89 0.05 0 cm /Im0 Do Q');
		expect(pages[1]!.box).toEqual([841.89, 595.28]);
		expect(pages[1]!.content).toBe('q 841.89 0 0 420.95 0 87.17 cm /Im0 Do Q');
		expect(pages[2]!.box).toEqual([595.28, 841.89]);
		expect(pages[2]!.content).toBe('q 595.28 0 0 595.28 0 123.31 cm /Im0 Do Q');
		const letter = parse(writePdf([jpeg(850, 1100)], { paper: 'letter' }));
		expect(letter.pages[0]!.box).toEqual([612, 792]);
	});

	it('carries no metadata: no info dictionary, producer, author, dates or ID, and no EXIF', () => {
		const bytes = writePdf([jpeg(100, 100, { metadata: true, progressive: true, trailer: true })]);
		const { text } = parse(bytes);
		for (const key of [
			'/Info',
			'/Producer',
			'/Author',
			'/Creator',
			'/CreationDate',
			'/ModDate',
			'/ID',
			'/Metadata',
			'D:20'
		])
			expect(text).not.toContain(key);
		for (const word of ['Exif', 'GPS', 'ICC', 'Sam', 'ftyp', 'SEFT'])
			expect(text).not.toContain(word);
	});

	it('gives the same bytes for the same pages (nothing time- or device-dependent)', () => {
		const pages = [jpeg(300, 400)];
		expect(writePdf(pages)).toEqual(writePdf(pages));
	});

	it('refuses no pages, a page that isn’t a JPEG, and an unknown paper', () => {
		expect(() => writePdf([])).toThrow(RangeError);
		expect(() => writePdf([jpeg(10, 10), new Uint8Array([1, 2])])).toThrow(/Page 2/);
		for (const paper of ['a3', 'constructor', 'toString', '__proto__'])
			expect(() => writePdf([jpeg(10, 10)], { paper: paper as 'a4' })).toThrow(RangeError);
	});
});

describe('PAGE_SIZES', () => {
	it('are in the proportions scans snap to', () => {
		for (const [name, { width, height }] of Object.entries(PAGE_SIZES))
			expect(height / width).toBeCloseTo(PAPER[name as keyof typeof PAPER], 3);
	});
});
