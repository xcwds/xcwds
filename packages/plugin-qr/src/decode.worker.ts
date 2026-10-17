/**
 * The decoding Worker: gets pixels, answers with the text (or `null`), so decoding never holds
 * up the page. `createDecoder()` starts one and terminates it on `close()`.
 */
import { decodeQr, type Pixels } from './decode.js';

self.onmessage = (event: MessageEvent<Pixels & { id: number }>) => {
	let text: string | null = null;
	try {
		text = decodeQr(event.data);
	} catch {
		// Unreadable pixels are no code.
	}
	self.postMessage({ id: event.data.id, text });
};
