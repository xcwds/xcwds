import { describe, expect, it, vi } from 'vitest';
import { jpegInfo } from './pdf.js';
import {
	SHARE_MESSAGES,
	canShareFiles,
	fileName,
	scanImages,
	scanPdf,
	shareFiles,
	type ShareEnv
} from './share.js';

// 27 October 2026, 09:01:42 local time.
const scannedAt = new Date(2026, 9, 27, 9, 1, 42).getTime();

/**
 * A JPEG's structure (not a decodable image): EXIF holding `tag`, a frame for `width`×`height`,
 * one scan, the end.
 */
function jpegBytes(width = 10, height = 14, tag = 0): Uint8Array {
	return new Uint8Array([
		...[0xff, 0xd8],
		...[0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, tag],
		...[0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff],
		...[0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
		...[0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34],
		...[0xff, 0xd9]
	]);
}

const pagesOf = (...jpegs: Uint8Array[]) => ({ jpegs: vi.fn(async () => jpegs) });

const bytesOf = async (file: File) => new Uint8Array(await file.arrayBuffer());
const text = async (file: File) => new TextDecoder('latin1').decode(await bytesOf(file));
/** Whether `bytes` still holds the EXIF segment's marker. */
const hasExif = (bytes: Uint8Array) => bytes.some((b, i) => b === 0xff && bytes[i + 1] === 0xe1);

function downloadEnv() {
	const clicked: { href: string; download: string }[] = [];
	const env: ShareEnv = {
		document: {
			body: { append: vi.fn() } as unknown as HTMLElement,
			createElement: (() => {
				const link = {
					href: '',
					download: '',
					rel: '',
					click: () => clicked.push({ href: link.href, download: link.download }),
					remove: vi.fn()
				};
				return link;
			}) as unknown as Document['createElement']
		},
		URL: { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }
	};
	return { env, clicked };
}

const shareEnv = (share: () => Promise<void>, canShare = true): ShareEnv => ({
	navigator: { share: vi.fn(share), canShare: vi.fn(() => canShare) }
});

describe('fileName', () => {
	it('names the scan for when it was made, in local time', () => {
		expect(fileName(scannedAt, 'pdf')).toBe('scan-20261027-090142.pdf');
		expect(fileName(scannedAt, 'jpg', 2)).toBe('scan-20261027-090142-2.jpg');
	});
});

describe('scanPdf', () => {
	it('makes one PDF of every page, in order, without their metadata', async () => {
		const result = await scanPdf(pagesOf(jpegBytes(10, 14, 7), jpegBytes(20, 10, 8)), {
			scannedAt
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const [file] = result.files as [File];
		expect(result.files).toHaveLength(1);
		expect(file.name).toBe('scan-20261027-090142.pdf');
		expect(file.type).toBe('application/pdf');
		const pdf = await text(file);
		expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
		expect(pdf).toContain('/Count 2');
		// The first page is portrait A4, the second landscape.
		expect(pdf).toContain('/MediaBox [0 0 595.28 841.89]');
		expect(pdf).toContain('/MediaBox [0 0 841.89 595.28]');
		expect(pdf).not.toContain('Exif');
		expect(pdf).not.toMatch(/\/Producer|\/Author|\/CreationDate/);
	});

	it('takes Letter, and the time now by default', async () => {
		vi.useFakeTimers({ now: scannedAt });
		try {
			const result = await scanPdf(pagesOf(jpegBytes()), { paper: 'letter' });
			if (!result.ok) throw new Error(result.error);
			expect(result.files[0]!.name).toBe('scan-20261027-090142.pdf');
			expect(await text(result.files[0]!)).toContain('/MediaBox [0 0 612 792]');
		} finally {
			vi.useRealTimers();
		}
	});

	it('says when there are no pages, or one can no longer be read', async () => {
		expect(await scanPdf(pagesOf())).toEqual({ ok: false, error: SHARE_MESSAGES.empty });
		expect(await scanPdf(pagesOf(jpegBytes(), new Uint8Array([1, 2, 3])))).toEqual({
			ok: false,
			error: "Page 2 couldn't be read. Retake it or delete it, then try again."
		});
	});

	it('refuses an unknown paper as writePdf does', async () => {
		await expect(scanPdf(pagesOf(jpegBytes()), { paper: 'a5' as never })).rejects.toThrow(
			RangeError
		);
	});
});

describe('scanImages', () => {
	it('gives each page as a numbered JPEG, without its metadata', async () => {
		const result = await scanImages(pagesOf(jpegBytes(10, 14, 7), jpegBytes(20, 10, 8)), {
			scannedAt
		});
		if (!result.ok) throw new Error(result.error);
		expect(result.files.map((f) => [f.name, f.type])).toEqual([
			['scan-20261027-090142-1.jpg', 'image/jpeg'],
			['scan-20261027-090142-2.jpg', 'image/jpeg']
		]);
		const [first, second] = await Promise.all(result.files.map(bytesOf));
		expect(hasExif(first!)).toBe(false);
		expect(jpegInfo(first!)).toEqual({ width: 10, height: 14, components: 3 });
		expect(jpegInfo(second!)).toEqual({ width: 20, height: 10, components: 3 });
	});

	it('says when there are no pages, or one can no longer be read', async () => {
		expect(await scanImages(pagesOf())).toEqual({ ok: false, error: SHARE_MESSAGES.empty });
		expect(await scanImages(pagesOf(new Uint8Array([0xff, 0xd8])))).toEqual({
			ok: false,
			error: "Page 1 couldn't be read. Retake it or delete it, then try again."
		});
	});
});

describe('shareFiles', () => {
	const pdf = new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' });
	const images = [
		new File(['a'], 'scan-1.jpg', { type: 'image/jpeg' }),
		new File(['b'], 'scan-2.jpg', { type: 'image/jpeg' })
	];

	it('shares the files in one share sheet where the browser can', async () => {
		const env = shareEnv(async () => {});
		expect(canShareFiles(undefined, env)).toBe(true);
		expect(await shareFiles(images, env)).toBe('shared');
		expect(env.navigator!.share).toHaveBeenCalledWith({ files: images });
	});

	it('says when the share sheet was dismissed or failed', async () => {
		const dismissed = shareEnv(async () => {
			throw new DOMException('no', 'AbortError');
		});
		expect(await shareFiles([pdf], dismissed)).toBe('cancelled');
		const broken = shareEnv(async () => {
			throw new Error('no');
		});
		expect(await shareFiles([pdf], broken)).toBe('failed');
		expect(
			await shareFiles(
				[],
				shareEnv(async () => {})
			)
		).toBe('cancelled');
	});

	it("downloads each file where they can't be shared", async () => {
		const { env, clicked } = downloadEnv();
		expect(canShareFiles(undefined, env)).toBe(false);
		expect(await shareFiles(images, { ...env, ...shareEnv(async () => {}, false) })).toBe('saved');
		expect(clicked).toEqual([
			{ href: 'blob:x', download: 'scan-1.jpg' },
			{ href: 'blob:x', download: 'scan-2.jpg' }
		]);
		expect(await shareFiles([pdf], { navigator: {} as never })).toBe('failed');
	});

	it('downloads when canShare throws', async () => {
		const { env, clicked } = downloadEnv();
		const throwing: ShareEnv = {
			...env,
			navigator: {
				share: vi.fn(async () => {}),
				canShare: vi.fn(() => {
					throw new TypeError('no');
				})
			}
		};
		expect(await shareFiles([pdf], throwing)).toBe('saved');
		expect(throwing.navigator!.share).not.toHaveBeenCalled();
		expect(clicked).toEqual([{ href: 'blob:x', download: 'scan.pdf' }]);
	});
});
