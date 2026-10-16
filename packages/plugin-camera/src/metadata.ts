/**
 * A small reader for the metadata an image file carries (#145): EXIF (camera, date, orientation,
 * GPS), XMP and other text, in JPEG, PNG and WebP files. It only reports what's there, for a tool
 * to show what cleaning removed; `cleanImage` removes it all by re-encoding the pixels. Every read
 * is bounds-checked: a truncated or malformed file reports what was read before the damage.
 */

export interface ImageMetadata {
	/** An EXIF block was found. */
	exif: boolean;
	/** The EXIF block has a location (GPS latitude or longitude). */
	gps: boolean;
	/** The camera's make and model, e.g. `Google Pixel 8`. */
	camera?: string;
	/** When it was taken, as the file writes it (`2026:10:16 08:12:00`, local time, no zone). */
	taken?: string;
	/** EXIF orientation, 1 to 8 (1 is upright). */
	orientation?: number;
	/** An XMP packet (editing history, often a copy of the EXIF data) was found. */
	xmp: boolean;
	/** Other embedded text: comments, IPTC captions and keywords, PNG text chunks. */
	other: boolean;
}

export const noMetadata = (): ImageMetadata => ({
	exif: false,
	gps: false,
	xmp: false,
	other: false
});

/** Longest camera or date text kept, so a hostile file can't hand a tool a huge string. */
const MAX_TEXT = 64;

const XMP_JPEG = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_KEYWORD = 'XML:com.adobe.xmp';

const ascii = (bytes: Uint8Array, start: number, length: number): string => {
	let s = '';
	const end = Math.min(bytes.length, start + length);
	for (let i = Math.max(0, start); i < end; i++) s += String.fromCharCode(bytes[i]!);
	return s;
};

const startsWith = (bytes: Uint8Array, at: number, text: string) =>
	ascii(bytes, at, text.length) === text;

/** Reads what metadata `bytes` (a whole image file) carries. Never throws. */
export function readMetadata(bytes: Uint8Array): ImageMetadata {
	const found = noMetadata();
	try {
		if (bytes[0] === 0xff && bytes[1] === 0xd8) readJpeg(bytes, found);
		else if (startsWith(bytes, 0, '\x89PNG\r\n\x1a\n')) readPng(bytes, found);
		else if (startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) readWebp(bytes, found);
	} catch {
		// A RangeError from a malformed file: keep what was found before it.
	}
	return found;
}

function readJpeg(bytes: Uint8Array, found: ImageMetadata) {
	let at = 2;
	while (at + 4 <= bytes.length) {
		if (bytes[at] !== 0xff) return;
		const marker = bytes[at + 1]!;
		// Fill bytes before a marker.
		if (marker === 0xff) {
			at++;
			continue;
		}
		// Markers without a length: start of image, restarts, end of image.
		if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
			at += 2;
			continue;
		}
		// Start of scan or end of image: the image data follows, no more metadata segments.
		if (marker === 0xda || marker === 0xd9) return;
		const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
		if (length < 2) return;
		const start = at + 4;
		const size = Math.min(length - 2, bytes.length - start);
		if (marker === 0xe1) {
			if (startsWith(bytes, start, 'Exif\0\0'))
				readTiff(bytes.subarray(start + 6, start + size), found);
			else if (startsWith(bytes, start, XMP_JPEG)) found.xmp = true;
			// Extended XMP continues the main packet.
			else if (startsWith(bytes, start, 'http://ns.adobe.com/xmp/extension/\0')) found.xmp = true;
		} else if (marker === 0xed || marker === 0xfe) {
			// APP13 (Photoshop: IPTC captions, keywords, credits) and comments.
			found.other = true;
		}
		at = start + length - 2;
	}
}

function readPng(bytes: Uint8Array, found: ImageMetadata) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let at = 8;
	while (at + 8 <= bytes.length) {
		const length = view.getUint32(at);
		const type = ascii(bytes, at + 4, 4);
		const start = at + 8;
		const data = bytes.subarray(start, Math.min(bytes.length, start + length));
		if (type === 'eXIf') readTiff(data, found);
		else if (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') {
			if (startsWith(data, 0, XMP_KEYWORD + '\0')) found.xmp = true;
			else found.other = true;
		} else if (type === 'IEND') return;
		at = start + length + 4;
	}
}

function readWebp(bytes: Uint8Array, found: ImageMetadata) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let at = 12;
	while (at + 8 <= bytes.length) {
		const type = ascii(bytes, at, 4);
		const length = view.getUint32(at + 4, true);
		const start = at + 8;
		const data = bytes.subarray(start, Math.min(bytes.length, start + length));
		// Some writers keep JPEG's `Exif\0\0` prefix.
		if (type === 'EXIF') readTiff(startsWith(data, 0, 'Exif\0\0') ? data.subarray(6) : data, found);
		else if (type === 'XMP ') found.xmp = true;
		at = start + length + (length % 2);
	}
}

const TAG = {
	make: 0x010f,
	model: 0x0110,
	orientation: 0x0112,
	dateTime: 0x0132,
	exifIfd: 0x8769,
	gpsIfd: 0x8825,
	dateTimeOriginal: 0x9003,
	gpsLatitude: 0x0002,
	gpsLongitude: 0x0004
} as const;

/** Bytes per value of each TIFF field type. */
const SIZES: Record<number, number> = {
	1: 1,
	2: 1,
	3: 2,
	4: 4,
	5: 8,
	6: 1,
	7: 1,
	8: 2,
	9: 4,
	10: 8,
	11: 4,
	12: 8
};

interface Field {
	type: number;
	count: number;
	/** Where the value starts, from the start of the TIFF data. */
	offset: number;
}

/** Reads the TIFF structure inside an EXIF block: IFD0, then the EXIF and GPS IFDs. */
function readTiff(tiff: Uint8Array, found: ImageMetadata) {
	found.exif = true;
	if (tiff.length < 8) return;
	const order = ascii(tiff, 0, 2);
	if (order !== 'II' && order !== 'MM') return;
	const little = order === 'II';
	const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
	if (view.getUint16(2, little) !== 42) return;

	const ifd = (offset: number): Map<number, Field> => {
		const fields = new Map<number, Field>();
		if (offset < 8 || offset + 2 > tiff.length) return fields;
		const count = view.getUint16(offset, little);
		for (let i = 0; i < count; i++) {
			const entry = offset + 2 + i * 12;
			if (entry + 12 > tiff.length) break;
			const type = view.getUint16(entry + 2, little);
			const n = view.getUint32(entry + 4, little);
			const size = (SIZES[type] ?? 0) * n;
			// Values of 4 bytes or less sit in the entry itself; longer ones elsewhere.
			const at = size <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
			fields.set(view.getUint16(entry, little), { type, count: n, offset: at });
		}
		return fields;
	};
	const text = (field: Field | undefined): string | undefined => {
		if (!field || field.type !== 2 || field.offset + field.count > tiff.length) return undefined;
		const value = ascii(tiff, field.offset, Math.min(field.count, MAX_TEXT))
			.replace(/\0[\s\S]*$/, '')
			.trim();
		return value || undefined;
	};
	const number = (field: Field | undefined): number | undefined => {
		if (!field || field.offset + 2 > tiff.length) return undefined;
		if (field.type === 3) return view.getUint16(field.offset, little);
		if (field.type === 4 && field.offset + 4 <= tiff.length)
			return view.getUint32(field.offset, little);
		return undefined;
	};

	const ifd0 = ifd(view.getUint32(4, little));
	const make = text(ifd0.get(TAG.make));
	const model = text(ifd0.get(TAG.model));
	// Models often repeat the make ("Canon" + "Canon EOS R6").
	const camera = model && make && !model.startsWith(make) ? `${make} ${model}` : (model ?? make);
	if (camera) found.camera = camera.slice(0, MAX_TEXT);
	const orientation = number(ifd0.get(TAG.orientation));
	if (orientation !== undefined && orientation >= 1 && orientation <= 8)
		found.orientation = orientation;

	const exifAt = number(ifd0.get(TAG.exifIfd));
	const exif = exifAt !== undefined ? ifd(exifAt) : new Map<number, Field>();
	const taken = text(exif.get(TAG.dateTimeOriginal)) ?? text(ifd0.get(TAG.dateTime));
	if (taken) found.taken = taken;

	const gpsAt = number(ifd0.get(TAG.gpsIfd));
	if (gpsAt !== undefined) {
		const gps = ifd(gpsAt);
		if (gps.has(TAG.gpsLatitude) || gps.has(TAG.gpsLongitude)) found.gps = true;
	}
}
