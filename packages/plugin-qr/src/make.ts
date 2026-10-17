/**
 * Making QR codes (#147): `qrSvg(text)` for any page, and the pieces `<QrCode>` draws with. All on
 * the device; nothing about the text leaves it.
 */
import { encodeQr, type EncodeOptions, type QrMatrix } from './encode.js';

export { encodeQr, QrTooLongError } from './encode.js';
export type { EncodeOptions, ErrorCorrection, QrMatrix } from './encode.js';

export interface QrSvgOptions extends EncodeOptions {
	/** Light modules around the code, which scanners need: default 4, as the standard asks. */
	margin?: number;
	/** What a screen reader says for the image. Default: `QR code: <text>`. */
	label?: string;
}

/**
 * The dark modules as one SVG path in module units, offset by `margin`: a rectangle per run of
 * dark modules in a row, so the path stays short and the edges stay crisp.
 */
export function qrPath(matrix: QrMatrix, margin = 4): string {
	const { size, modules } = matrix;
	let d = '';
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			if (!modules[y * size + x]) continue;
			let end = x;
			while (end + 1 < size && modules[y * size + end + 1]) end++;
			d += `M${x + margin} ${y + margin}h${end - x + 1}v1h${x - end - 1}z`;
			x = end;
		}
	return d;
}

export function checkMargin(margin: number): number {
	if (!Number.isInteger(margin) || margin < 0)
		throw new RangeError('`margin` must be a whole number of modules, 0 or more.');
	return margin;
}

const escape = (s: string) =>
	s.replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c as '&' | '<' | '>' | '"']
	);

/**
 * `text` as a QR code in an SVG string: black on white (scanners need the contrast, whatever the
 * page's theme), scaling to whatever size it's shown at. Throws `QrTooLongError` when the text
 * doesn't fit.
 */
export function qrSvg(text: string, options: QrSvgOptions = {}): string {
	const margin = checkMargin(options.margin ?? 4);
	const matrix = encodeQr(text, options);
	const side = matrix.size + margin * 2;
	const label = escape(options.label ?? `QR code: ${text}`);
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" role="img" aria-label="${label}" shape-rendering="crispEdges">` +
		`<rect width="${side}" height="${side}" fill="#fff"/>` +
		`<path fill="#000" d="${qrPath(matrix, margin)}"/></svg>`
	);
}

export interface QrPngOptions extends EncodeOptions {
	/** Light modules around the code. Default 4. */
	margin?: number;
	/** Pixels per module: default 8, so a link-sized code is about 300 px. */
	scale?: number;
}

/** `text` as a QR code in a PNG, black on white, `scale` pixels per module. Browser only. */
export async function qrPng(text: string, options: QrPngOptions = {}): Promise<Blob> {
	const margin = checkMargin(options.margin ?? 4);
	const scale = options.scale ?? 8;
	if (!Number.isInteger(scale) || scale < 1 || scale > 64)
		throw new RangeError('`scale` must be a whole number of pixels from 1 to 64.');
	const { size, modules } = encodeQr(text, options);
	const side = (size + margin * 2) * scale;
	const canvas =
		typeof OffscreenCanvas === 'function'
			? new OffscreenCanvas(side, side)
			: Object.assign(document.createElement('canvas'), { width: side, height: side });
	const context = canvas.getContext('2d') as
		CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
	if (!context) throw new Error("This browser can't draw images here.");
	context.fillStyle = '#fff';
	context.fillRect(0, 0, side, side);
	context.fillStyle = '#000';
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++)
			if (modules[y * size + x])
				context.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
	if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error("The PNG couldn't be made."))),
			'image/png'
		)
	);
}

export interface SaveQrOptions extends QrPngOptions {
	/** `'svg'` (default: sharp at any size) or `'png'` (for apps that don't take SVG). */
	format?: 'svg' | 'png';
	/** The file name without its extension. Default `qr-code`. */
	name?: string;
	/** For `'svg'`: what a screen reader says, as in `qrSvg`. */
	label?: string;
}

/**
 * Downloads `text` as a QR code file (`qr-code.svg` or `qr-code.png`), made on the device.
 * Call it from a tap. Throws `QrTooLongError` when the text doesn't fit.
 */
export async function saveQr(text: string, options: SaveQrOptions = {}): Promise<void> {
	const format = options.format ?? 'svg';
	const blob =
		format === 'png'
			? await qrPng(text, options)
			: new Blob([qrSvg(text, options)], { type: 'image/svg+xml' });
	const name = (options.name ?? 'qr-code').replace(/[\\/:*?"<>|]/g, '-') || 'qr-code';
	const url = URL.createObjectURL(blob);
	try {
		const link = document.createElement('a');
		link.href = url;
		link.download = `${name}.${format}`;
		link.rel = 'noopener';
		document.body.append(link);
		link.click();
		link.remove();
	} finally {
		// After the click has started the download.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}
