/**
 * The QR decoder that runs where `BarcodeDetector` can't: jsQR, plain JavaScript (no WASM, so the
 * CSP stays as it is). Pure: pixels in, text out, so it runs in the Worker and in unit tests.
 */
import jsqr from 'jsqr';

// jsQR is CommonJS with an ES-style default in its types.
const jsQR = ((jsqr as unknown as { default?: unknown }).default ??
	jsqr) as typeof import('jsqr').default;

/** RGBA pixels, as `ImageData` has them. */
export interface Pixels {
	data: Uint8ClampedArray;
	width: number;
	height: number;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** The text of the QR code in `pixels`, or `null` when there's none it can read. */
export function decodeQr({ data, width, height }: Pixels): string | null {
	// Dark on light first; a light-on-dark code is rarer, so it's tried second.
	const found = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
	if (!found) return null;
	// Most codes hold UTF-8 whatever they declare; jsQR's own text is the fallback.
	try {
		return utf8.decode(new Uint8Array(found.binaryData));
	} catch {
		return found.data;
	}
}
