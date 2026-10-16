import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanImage, fitSize, noMetadata, readMetadata } from './image.js';

/** A TIFF field: an ASCII string, a SHORT, or LONG pointers / RATIONALs filled in by `tiff()`. */
type Value = { ascii: string } | { short: number } | { ifd: Entry[] } | { rational: number[] };
type Entry = [tag: number, value: Value];

/** Builds the TIFF data of an EXIF block, in either byte order. */
function tiff(ifd0: Entry[], little = true): Uint8Array {
	const bytes: number[] = [];
	const u16 = (at: number, v: number) => {
		const b = little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff];
		bytes[at] = b[0]!;
		bytes[at + 1] = b[1]!;
	};
	const u32 = (at: number, v: number) => {
		const b = [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
		if (little) b.reverse();
		b.forEach((x, i) => (bytes[at + i] = x));
	};
	const end = () => bytes.length;
	const alloc = (n: number) => {
		const at = end();
		for (let i = 0; i < n; i++) bytes.push(0);
		return at;
	};
	bytes.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]));
	alloc(6);
	u16(2, 42);
	const write = (entries: Entry[]): number => {
		const at = alloc(2 + entries.length * 12 + 4);
		u16(at, entries.length);
		entries.forEach(([tag, value], i) => {
			const e = at + 2 + i * 12;
			u16(e, tag);
			if ('ascii' in value) {
				const text = value.ascii + '\0';
				u16(e + 2, 2);
				u32(e + 4, text.length);
				const data = text.length <= 4 ? e + 8 : alloc(text.length);
				if (data !== e + 8) u32(e + 8, data);
				[...text].forEach((c, j) => (bytes[data + j] = c.charCodeAt(0)));
			} else if ('short' in value) {
				u16(e + 2, 3);
				u32(e + 4, 1);
				u16(e + 8, value.short);
			} else if ('rational' in value) {
				u16(e + 2, 5);
				u32(e + 4, value.rational.length);
				const data = alloc(value.rational.length * 8);
				u32(e + 8, data);
				value.rational.forEach((r, j) => {
					u32(data + j * 8, r);
					u32(data + j * 8 + 4, 1);
				});
			} else {
				u16(e + 2, 4);
				u32(e + 4, 1);
				u32(e + 8, write(value.ifd));
			}
		});
		return at;
	};
	u32(4, write(ifd0));
	return Uint8Array.from(bytes);
}

const PHOTO: Entry[] = [
	[0x010f, { ascii: 'Google' }],
	[0x0110, { ascii: 'Pixel 8' }],
	[0x0112, { short: 6 }],
	[0x0132, { ascii: '2026:10:16 09:00:00' }],
	[0x8769, { ifd: [[0x9003, { ascii: '2026:10:16 08:12:00' }]] }],
	[
		0x8825,
		{
			ifd: [
				[0x0001, { ascii: 'N' }],
				[0x0002, { rational: [41, 52, 30] }],
				[0x0004, { rational: [87, 37, 20] }]
			]
		}
	]
];

const concat = (...parts: (Uint8Array | number[] | string)[]) =>
	Uint8Array.from(
		parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : [...p]))
	);
const be16 = (n: number) => [n >> 8, n & 0xff];
const be32 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le32 = (n: number) => be32(n).reverse();

const segment = (marker: number, data: Uint8Array) =>
	concat([0xff, marker], be16(data.length + 2), data);
const SOS = [0xff, 0xda, 0, 2];
const jpeg = (...segments: Uint8Array[]) =>
	concat([0xff, 0xd8], ...segments, SOS, [1, 2, 3, 0xff, 0xd9]);
const exifSegment = (t: Uint8Array) => segment(0xe1, concat('Exif\0\0', t));

const chunk = (type: string, data: Uint8Array) =>
	concat(be32(data.length), type, data, [0, 0, 0, 0]);
const png = (...chunks: Uint8Array[]) =>
	concat(
		'\x89PNG\r\n\x1a\n',
		chunk('IHDR', new Uint8Array(13)),
		...chunks,
		chunk('IEND', new Uint8Array())
	);

const webpChunk = (type: string, data: Uint8Array) =>
	concat(type, le32(data.length), data, data.length % 2 ? [0] : []);
const webp = (...chunks: Uint8Array[]) => {
	const body = concat('WEBP', webpChunk('VP8L', new Uint8Array(5)), ...chunks);
	return concat('RIFF', le32(body.length), body);
};

const FULL = {
	exif: true,
	gps: true,
	camera: 'Google Pixel 8',
	taken: '2026:10:16 08:12:00',
	orientation: 6,
	xmp: false,
	other: false
};

describe('readMetadata', () => {
	it('reads a JPEG photo’s camera, date, orientation and location, in both byte orders', () => {
		expect(readMetadata(jpeg(exifSegment(tiff(PHOTO))))).toEqual(FULL);
		expect(readMetadata(jpeg(exifSegment(tiff(PHOTO, false))))).toEqual(FULL);
	});

	it('finds XMP, comments and IPTC in a JPEG', () => {
		const xmp = segment(0xe1, concat('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'));
		expect(readMetadata(jpeg(xmp))).toMatchObject({ exif: false, xmp: true, other: false });
		expect(readMetadata(jpeg(segment(0xfe, concat('hello'))))).toMatchObject({ other: true });
		expect(readMetadata(jpeg(segment(0xed, concat('Photoshop 3.0\0'))))).toMatchObject({
			other: true
		});
	});

	it('stops at the image data, so pixels that look like markers are ignored', () => {
		const after = concat([0xff, 0xd8], SOS, exifSegment(tiff(PHOTO)), [0xff, 0xd9]);
		expect(readMetadata(after)).toEqual(noMetadata());
	});

	it('reads EXIF and XMP in PNG and WebP files', () => {
		expect(readMetadata(png(chunk('eXIf', tiff(PHOTO))))).toEqual(FULL);
		expect(
			readMetadata(png(chunk('iTXt', concat('XML:com.adobe.xmp\0\0\0\0\0<x/>'))))
		).toMatchObject({
			xmp: true,
			other: false
		});
		expect(readMetadata(png(chunk('tEXt', concat('Comment\0hi'))))).toMatchObject({ other: true });
		expect(readMetadata(webp(webpChunk('EXIF', tiff(PHOTO))))).toEqual(FULL);
		// Some writers keep JPEG's prefix.
		expect(readMetadata(webp(webpChunk('EXIF', concat('Exif\0\0', tiff(PHOTO)))))).toEqual(FULL);
		expect(readMetadata(webp(webpChunk('XMP ', concat('<x/>'))))).toMatchObject({ xmp: true });
	});

	it('reports a location only when there are coordinates', () => {
		const noFix: Entry[] = [[0x8825, { ifd: [[0x0001, { ascii: 'N' }]] }]];
		expect(readMetadata(jpeg(exifSegment(tiff(noFix))))).toMatchObject({ exif: true, gps: false });
	});

	it('keeps a model that already names its make, and caps long text', () => {
		const canon: Entry[] = [
			[0x010f, { ascii: 'Canon' }],
			[0x0110, { ascii: 'Canon EOS R6' }]
		];
		expect(readMetadata(jpeg(exifSegment(tiff(canon)))).camera).toBe('Canon EOS R6');
		const long: Entry[] = [[0x0110, { ascii: 'x'.repeat(500) }]];
		expect(readMetadata(jpeg(exifSegment(tiff(long)))).camera).toBe('x'.repeat(64));
	});

	it('ignores an orientation outside 1 to 8', () => {
		const odd: Entry[] = [[0x0112, { short: 9 }]];
		expect(readMetadata(jpeg(exifSegment(tiff(odd)))).orientation).toBeUndefined();
	});

	it('never throws on damaged or unknown files', () => {
		const whole = jpeg(exifSegment(tiff(PHOTO)));
		for (let n = 0; n < whole.length; n++)
			expect(() => readMetadata(whole.subarray(0, n))).not.toThrow();
		const corrupt = whole.slice();
		// Point IFD0 far outside the data.
		corrupt.set([0xff, 0xff, 0xff, 0x7f], 2 + 4 + 6 + 4);
		expect(readMetadata(corrupt)).toMatchObject({ exif: true, gps: false });
		expect(readMetadata(concat('GIF89a'))).toEqual(noMetadata());
		expect(readMetadata(new Uint8Array())).toEqual(noMetadata());
		expect(readMetadata(segment(0xe1, new Uint8Array(0)))).toEqual(noMetadata());
	});
});

describe('fitSize', () => {
	it('scales the longer side down to maxSide, never up', () => {
		expect(fitSize(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
		expect(fitSize(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
		expect(fitSize(800, 600, 2000)).toEqual({ width: 800, height: 600 });
		expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
		expect(fitSize(800, 600, Number.NaN)).toEqual({ width: 800, height: 600 });
		expect(fitSize(10_000, 1, 100)).toEqual({ width: 100, height: 1 });
	});
});

describe('cleanImage', () => {
	afterEach(() => vi.unstubAllGlobals());

	/** A browser stand-in: decodes to a 4000×3000 bitmap and encodes what's drawn. */
	function stubBrowser({ decodes = true, writes = 'image/jpeg' } = {}) {
		const drawn: unknown[][] = [];
		const close = vi.fn();
		const decode = vi.fn(async () => {
			if (!decodes) throw new DOMException('bad', 'InvalidStateError');
			return { width: 4000, height: 3000, close };
		});
		class Canvas {
			constructor(
				public width: number,
				public height: number
			) {}
			getContext() {
				return {
					fillStyle: '',
					fillRect(...args: unknown[]) {
						drawn.push(['fill', this.fillStyle, ...args]);
					},
					drawImage: (...args: unknown[]) => drawn.push(args)
				};
			}
			async convertToBlob({ type }: { type: string }) {
				return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
					type: type === 'image/webp' ? writes : type
				});
			}
		}
		vi.stubGlobal('createImageBitmap', decode);
		vi.stubGlobal('OffscreenCanvas', Canvas);
		return { decode, drawn, close };
	}

	const photo = () => new Blob([jpeg(exifSegment(tiff(PHOTO)))], { type: 'image/jpeg' });

	it('re-encodes from the upright pixels and reports what was removed', async () => {
		const { decode, drawn, close } = stubBrowser();
		const result = await cleanImage(photo(), { maxSide: 2000 });
		expect(result).toMatchObject({ ok: true, width: 2000, height: 1500, type: 'image/jpeg' });
		if (!result.ok) return;
		expect(result.removed).toEqual(FULL);
		expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(
			new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
		);
		expect(decode).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'from-image' });
		// JPEG has no transparency: a white background goes under the image.
		expect(drawn).toEqual([
			['fill', '#fff', 0, 0, 2000, 1500],
			[expect.anything(), 0, 0, 2000, 1500]
		]);
		expect(close).toHaveBeenCalled();
	});

	it('says which type the browser wrote when it can’t write WebP', async () => {
		const { drawn } = stubBrowser({ writes: 'image/png' });
		const result = await cleanImage(photo(), { type: 'image/webp' });
		expect(result).toMatchObject({ ok: true, type: 'image/png', width: 4000 });
		// WebP and PNG keep transparency, so nothing is painted under the image.
		expect(drawn).toEqual([[expect.anything(), 0, 0, 4000, 3000]]);
	});

	it('ignores options it can’t use', async () => {
		stubBrowser();
		const result = await cleanImage(photo(), {
			type: 'image/gif' as 'image/jpeg',
			quality: 7,
			maxSide: -1
		});
		expect(result).toMatchObject({ ok: true, type: 'image/jpeg', width: 4000, height: 3000 });
	});

	it('returns an error for an image the browser can’t open', async () => {
		stubBrowser({ decodes: false });
		const result = await cleanImage(new Blob(['not an image']));
		expect(result).toEqual({
			ok: false,
			error: "This browser can't open this image. Try a JPEG, PNG or WebP file."
		});
	});

	it('returns an error without image support at all', async () => {
		vi.stubGlobal('createImageBitmap', undefined);
		expect(await cleanImage(photo())).toMatchObject({ ok: false });
	});
});
