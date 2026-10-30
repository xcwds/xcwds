// The probes behind docs/camera.md's ✅ cells (#143), shared by the Chromium checks in
// camera-support.test.ts and the Firefox ones in e2e-firefox/. Each runs in the page through
// `page.evaluate`, so it must not use anything from outside its own body.

/** What @xcwds/plugin-camera relies on, from the browser's (fake) camera. */
export async function probeCamera() {
	const size = (track: MediaStreamTrack) => {
		const { width, height } = track.getSettings();
		return `${width}x${height}`;
	};
	const plain = await navigator.mediaDevices.getUserMedia({ video: true });
	const track = plain.getVideoTracks()[0]!;
	const caps = track.getCapabilities() as MediaTrackCapabilities & Record<string, unknown>;
	const constrained = typeof track.applyConstraints === 'function';
	const plainSize = size(track);
	track.stop();

	const large = await navigator.mediaDevices.getUserMedia({
		video: { width: { ideal: 4096 }, height: { ideal: 4096 } }
	});
	const big = large.getVideoTracks()[0]!;
	const largest = size(big);
	const capture = 'ImageCapture' in window;
	let photo = '';
	let frame = 0;
	if (capture) {
		// Not in TypeScript's DOM types.
		type Capture = {
			getPhotoCapabilities(): Promise<unknown>;
			takePhoto(): Promise<Blob>;
			grabFrame(): Promise<ImageBitmap>;
		};
		const { ImageCapture } = window as unknown as {
			ImageCapture: new (track: MediaStreamTrack) => Capture;
		};
		const camera = new ImageCapture(big);
		await camera.getPhotoCapabilities();
		photo = (await camera.takePhoto()).type;
		frame = (await camera.grabFrame()).width;
	}
	big.stop();

	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 4;
	const blobType = (type: string) =>
		new Promise<string | undefined>((done) => canvas.toBlob((blob) => done(blob?.type), type));
	let oriented = true;
	try {
		await createImageBitmap(canvas, { imageOrientation: 'from-image' });
	} catch {
		oriented = false;
	}
	return {
		plainSize,
		largest,
		constrained,
		facing: caps.facingMode ?? [],
		zoom: 'zoom' in caps,
		torch: 'torch' in caps,
		focus: 'focusMode' in caps && 'exposureMode' in caps,
		capture,
		photo,
		frame,
		barcode: 'BarcodeDetector' in window,
		oriented,
		offscreen: typeof OffscreenCanvas === 'function',
		jpeg: await blobType('image/jpeg'),
		webp: await blobType('image/webp'),
		persist: typeof navigator.storage.persist === 'function',
		share: typeof navigator.share === 'function'
	};
}

/** What @xcwds/plugin-recorder relies on, from the browser's (fake) microphone (#150). */
export async function probeRecorder() {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
	});
	const track = stream.getAudioTracks()[0]!;
	const { echoCancellation, noiseSuppression, autoGainControl } = track.getSettings();
	const records = (type: string) => MediaRecorder.isTypeSupported(type);
	// Chunks every `timeslice`, joined into one file the page can play.
	const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
	const chunks: Blob[] = [];
	recorder.ondataavailable = (event) => chunks.push(event.data);
	recorder.start(250);
	await new Promise((done) => setTimeout(done, 1200));
	await new Promise((done) => {
		recorder.onstop = done;
		recorder.stop();
	});
	track.stop();
	const audio = new Audio(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })));
	const plays = await new Promise<boolean>((done) => {
		audio.onloadedmetadata = () => done(true);
		audio.onerror = () => done(false);
	});
	const canPlay = (type: string) => audio.canPlayType(type);
	return {
		processing: [echoCancellation, noiseSuppression, autoGainControl],
		webm: records('audio/webm;codecs=opus'),
		ogg: records('audio/ogg;codecs=opus'),
		mp4: records('audio/mp4'),
		chunks: chunks.length > 1,
		plays,
		playsWebm: canPlay('audio/webm; codecs="opus"'),
		playsOgg: canPlay('audio/ogg; codecs="opus"'),
		wakeLock: 'wakeLock' in navigator,
		locks: 'locks' in navigator,
		share: typeof navigator.share === 'function'
	};
}
