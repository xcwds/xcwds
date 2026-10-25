/**
 * `@xcwds/plugin-scanner/pdf`: a small PDF writer for scans, one JPEG image per page. JPEG goes
 * into a PDF as it is (`DCTDecode`), so nothing is re-encoded and no library is needed. The file
 * carries nothing but the pages: no producer, author, title or dates, and no document ID. Pure
 * functions, safe to import anywhere.
 */
import type { Paper } from './geometry.js';

/** Page sizes in PDF points (1/72 inch), portrait, in the proportions of `PAPER`. */
export const PAGE_SIZES: Record<Paper, { width: number; height: number }> = {
	a4: { width: 595.28, height: 841.89 },
	letter: { width: 612, height: 792 }
};

export interface JpegInfo {
	width: number;
	height: number;
	/** 1 for greyscale, 3 for colour. */
	components: 1 | 3;
}

/**
 * The size and colour components of a baseline or progressive JPEG, from its frame header, or
 * `null` when `bytes` isn't a JPEG this writer can embed (CMYK included).
 */
export function jpegInfo(bytes: Uint8Array): JpegInfo | null {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let i = 2;
	while (i + 4 <= bytes.length) {
		if (bytes[i] !== 0xff) return null;
		const marker = bytes[i + 1]!;
		// Fill bytes, and markers without a length.
		if (marker === 0xff) {
			i++;
			continue;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			i += 2;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) return null; // End of image or scan before a frame.
		const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
		if (length < 2) return null;
		// Start of frame: every SOFn but DHT (C4), JPG (C8) and DAC (CC).
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			if (i + 10 > bytes.length) return null;
			const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
			const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
			const components = bytes[i + 9]!;
			if (!width || !height || (components !== 1 && components !== 3)) return null;
			return { width, height, components };
		}
		i += 2 + length;
	}
	return null;
}

/**
 * `bytes` without the segments that carry metadata: comments and every application segment but
 * APP0 (JFIF) and APP14 (Adobe, which says how the colours are encoded). That drops EXIF (GPS,
 * camera, dates), XMP, ICC profiles and maker notes. The image data is copied as it is. EXIF's
 * orientation goes too, so pass images whose pixels are upright, as a canvas encodes them. `null`
 * when `bytes` isn't a JPEG.
 */
export function stripJpeg(bytes: Uint8Array): Uint8Array | null {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	const keep: Uint8Array[] = [bytes.subarray(0, 2)];
	let i = 2;
	while (i + 4 <= bytes.length) {
		if (bytes[i] !== 0xff) return null;
		const marker = bytes[i + 1]!;
		if (marker === 0xff) {
			i++;
			continue;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			keep.push(bytes.subarray(i, i + 2));
			i += 2;
			continue;
		}
		if (marker === 0xd9) return null;
		const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
		if (length < 2 || i + 2 + length > bytes.length) return null;
		if (marker === 0xda) {
			// Start of scan: the entropy-coded data and everything after it go in unchanged.
			keep.push(bytes.subarray(i));
			const out = new Uint8Array(keep.reduce((n, part) => n + part.length, 0));
			let at = 0;
			for (const part of keep) {
				out.set(part, at);
				at += part.length;
			}
			return out;
		}
		const metadata = marker === 0xfe || (marker >= 0xe1 && marker <= 0xef && marker !== 0xee);
		if (!metadata) keep.push(bytes.subarray(i, i + 2 + length));
		i += 2 + length;
	}
	return null;
}

export interface PdfOptions {
	/** The page size: A4 (the default) or Letter. A page is landscape when its image is. */
	paper?: Paper;
}

/**
 * A PDF with one page per JPEG in `pages`, each image as large as fits the page and centred, and
 * each through `stripJpeg` first, so a photo's EXIF never reaches the file.
 * Throws a `RangeError` when there are no pages or one isn't a JPEG `jpegInfo` can read.
 */
export function writePdf(pages: readonly Uint8Array[], options: PdfOptions = {}): Uint8Array {
	if (!pages.length) throw new RangeError('A PDF needs at least one page.');
	const paper = PAGE_SIZES[options.paper ?? 'a4'];
	if (!paper) throw new RangeError('The paper must be "a4" or "letter".');
	const images = pages.map((page, n) => {
		const jpeg = stripJpeg(page);
		const info = jpeg && jpegInfo(jpeg);
		if (!jpeg || !info) throw new RangeError(`Page ${n + 1} isn't a greyscale or colour JPEG.`);
		return { jpeg, info };
	});

	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const offsets: number[] = [];
	let length = 0;
	const write = (part: string | Uint8Array) => {
		const bytes = typeof part === 'string' ? encoder.encode(part) : part;
		chunks.push(bytes);
		length += bytes.length;
	};
	const object = (id: number, body: string, stream?: Uint8Array) => {
		offsets[id] = length;
		write(`${id} 0 obj\n${body}\n`);
		if (stream) {
			write('stream\n');
			write(stream);
			write('\nendstream\n');
		}
		write('endobj\n');
	};

	// The second line, a comment of bytes above 127, tells tools the file holds binary data.
	write('%PDF-1.4\n');
	write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
	// Objects: 1 the catalog, 2 the page tree, then three per page (page, contents, image).
	const pageId = (n: number) => 3 + n * 3;
	object(1, '<< /Type /Catalog /Pages 2 0 R >>');
	object(
		2,
		`<< /Type /Pages /Kids [${pages.map((_, n) => `${pageId(n)} 0 R`).join(' ')}] /Count ${pages.length} >>`
	);
	images.forEach(({ jpeg, info }, n) => {
		const landscape = info.width > info.height;
		const pageWidth = landscape ? paper.height : paper.width;
		const pageHeight = landscape ? paper.width : paper.height;
		const scale = Math.min(pageWidth / info.width, pageHeight / info.height);
		const w = info.width * scale;
		const h = info.height * scale;
		const x = (pageWidth - w) / 2;
		const y = (pageHeight - h) / 2;
		const id = pageId(n);
		object(
			id,
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageWidth)} ${num(pageHeight)}] ` +
				`/Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`
		);
		const content = encoder.encode(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /Im0 Do Q`);
		object(id + 1, `<< /Length ${content.length} >>`, content);
		object(
			id + 2,
			`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} ` +
				`/ColorSpace /${info.components === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 ` +
				`/Filter /DCTDecode /Length ${jpeg.length} >>`,
			jpeg
		);
	});

	const xref = length;
	const count = offsets.length;
	let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
	for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
	write(table);
	write(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

	const out = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

/** A number as PDF writes it: at most two decimals, no exponent. */
function num(value: number): string {
	return String(Math.round(value * 100) / 100);
}
