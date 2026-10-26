/**
 * The processing Worker: gets a photo and the page's corners, answers with the finished page (and
 * its JPEG, when asked), so straightening, filtering and encoding never hold up the page.
 * `createProcessor()` starts one and terminates it on `close()`.
 */
import { answer, type ProcessRequest } from './process.js';

self.onmessage = async (event: MessageEvent<ProcessRequest>) => {
	const { response, transfer } = await answer(event.data);
	self.postMessage(response, { transfer });
};
