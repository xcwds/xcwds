# @xcwds/plugin-camera

Photos taken inside an [@xcwds](https://github.com/xcwds/xcwds) app, with no metadata and the
camera on only while it's being used. **Work in progress**
([#145](https://github.com/xcwds/xcwds/issues/145)): not published yet, and not a plugin you can
install yet.

So far it holds the camera controller, from `@xcwds/plugin-camera/camera`, and the image cleaning,
from `@xcwds/plugin-camera/image`. The `<Camera>` viewfinder component, the plugin that hands the
controller to the app as `app.camera` (and stops it when the page is hidden or the app locks)
and the browser notes come next; keeping photos in the app is #146.

## The camera controller

```ts
import { createCamera } from '@xcwds/plugin-camera/camera';

const camera = createCamera({ facing: 'environment', maxSide: 2048 });
button.onclick = async () => {
	// Browsers ask for permission here, so call it from a tap, never on page load.
	if ((await camera.start()) !== 'live') return showError(camera.error);
	video.srcObject = camera.stream; // <video playsinline muted>
};
shutter.onclick = async () => {
	const result = await camera.capture(video);
	if (result.ok) save(result.photo.blob); // a JPEG with no metadata
};
// When done, or when the page is hidden: every track stops and the camera light goes off.
camera.stop();
```

- **`state`**: `idle`, `asking`, `live`, `denied`, `unavailable` or `error`, with **`error`** a
  sentence to show (blocked, no camera, in use by another app, not a secure page). `onChange`
  follows it.
- **`start(facing?)`**, **`stop()`**, **`switchFacing()`** and **`cameras()`** (how many there
  are). A permission answer that arrives after `stop()` is dropped and its stream stopped.
  **`suspend()`** turns a live camera off and **`resume()`** turns it back on, only if it was on.
- **`capabilities()`** and **`setZoom(value)`**: the camera's own zoom where the browser reports
  one, else a **digital zoom** (`kind: 'digital'`) that crops the centre of the frame. It adds no
  detail, so label it as such; it stops where the crop would drop under 1 megapixel, or at
  `maxDigitalZoom` (default 4). Firefox never reports camera zoom, so it always gets
  digital zoom. **`setTorch(on)`** where the camera has a light.
- **`capture(video)`** takes a full-resolution still with `ImageCapture.takePhoto()` where it
  works (Chromium on Android), else the viewfinder's current frame, crops it to the digital zoom
  and re-encodes it from pixels: `{ ok: true, photo: { blob, width, height, type, takenAt } }`,
  or `{ ok: false, error }`. `capturing` is true until the photo is encoded.

Options: `facing`, `type` (`image/jpeg` or `image/webp`), `quality`, `maxSide` and
`maxDigitalZoom`, all JSON. Nothing here makes a network request.

## Cleaning an image

```ts
import { cleanImage } from '@xcwds/plugin-camera/image';

const result = await cleanImage(file, { maxSide: 2048 });
if (result.ok) {
	// result.blob: a new JPEG made from the pixels only, upright, at most 2048 px on a side.
	// result.removed: what the original carried, e.g. { exif: true, gps: true, camera: 'Google Pixel 8', ... }
} else {
	showError(result.error); // e.g. a HEIC photo in a browser that can't open HEIC
}
```

`cleanImage(file, options)` decodes any image the browser can open (`createImageBitmap`, applying
its EXIF orientation), draws it to a canvas (`OffscreenCanvas` where there is one) and encodes a
new file from those pixels, so no EXIF, GPS, XMP, IPTC or comments survive. It never rejects: an
image the browser can't open, or can't write back, gives `{ ok: false, error }` with a sentence
to show.

- **`maxSide`**: scale down so neither side is longer (never up). Default: keep the size.
- **`type`**: `image/jpeg` (default) or `image/webp`. A browser that can't write WebP writes PNG;
  `result.type` says what was written.
- **`quality`**: 0 to 1, default 0.92.

`readMetadata(bytes)` is the reader behind `result.removed`: a small, dependency-free parser for
JPEG, PNG and WebP files that reports whether there's EXIF, a GPS location, XMP or other embedded
text, plus the camera, the date taken and the orientation. It's bounds-checked and never throws;
a damaged file reports what was read before the damage. It reads; it never edits a file in place.

Both are framework-agnostic and safe to import during prerender: they use browser APIs only when
called. Nothing here makes a network request.
