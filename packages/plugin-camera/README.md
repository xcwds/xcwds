# @xcwds/plugin-camera

Photos taken inside an [@xcwds](https://github.com/xcwds/xcwds) app, with no metadata and the
camera on only while it's being used. **Work in progress**
([#145](https://github.com/xcwds/xcwds/issues/145)): not published yet, and not a plugin you can
install yet.

So far it holds the image cleaning, from `@xcwds/plugin-camera/image`. The viewfinder, capture and
`app.camera` come next; keeping photos in the app is #146.

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
