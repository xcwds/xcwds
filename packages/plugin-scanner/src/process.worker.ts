/**
 * The processing Worker: gets a photo and the page's corners, answers with the finished page, so
 * straightening and filtering never hold up the page. `createProcessor()` starts one and
 * terminates it on `close()`.
 */
import { answer, type ProcessRequest } from './process.js';

self.onmessage = (event: MessageEvent<ProcessRequest>) => {
	const { response, transfer } = answer(event.data);
	self.postMessage(response, { transfer });
};
