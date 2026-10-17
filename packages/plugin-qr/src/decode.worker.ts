/**
 * The decoding Worker: gets pixels, answers with the text (or `null`), so a large image never
 * holds up the page. One per scan; whoever made it terminates it.
 */
import { decodeQr, type Pixels } from './decode.js';

self.onmessage = (event: MessageEvent<Pixels>) => {
	let text: string | null = null;
	try {
		text = decodeQr(event.data);
	} catch {
		// Unreadable pixels are no code.
	}
	self.postMessage(text);
};
