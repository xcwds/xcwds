/**
 * The processing Worker: gets a photo and the page's corners, answers with the finished page (and
 * its JPEG, when asked), so straightening, filtering and encoding never hold up the page.
 * `createProcessor()` starts one and terminates it on `close()`.
 */
import { answer, type ProcessRequest } from './process.js';

self.onmessage = (event: MessageEvent<ProcessRequest>) => {
	answer(event.data)
		.then(({ response, transfer }) => self.postMessage(response, { transfer }))
		.catch((e: unknown) => {
			// Thrown again outside the promise, so it fires the Worker's `error` event and the page
			// finishes the work, rather than waiting for an answer that never comes.
			setTimeout(() => {
				throw e;
			});
		});
};
