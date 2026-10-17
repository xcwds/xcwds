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
