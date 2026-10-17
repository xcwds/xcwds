# @xcwds/plugin-camera

Photos taken inside an [@xcwds](https://github.com/xcwds/xcwds) app, with no metadata and the
camera on only while it's being used. **Work in progress**
([#145](https://github.com/xcwds/xcwds/issues/145)): not published yet.

So far it holds the plugin, which hands the app a camera controller as `app.camera`, the
`<Camera>` viewfinder, the controller itself, from `@xcwds/plugin-camera/camera`, and the image
cleaning, from `@xcwds/plugin-camera/image`, and the start of keeping photos in the app
([#146](https://github.com/xcwds/xcwds/issues/146)): `app.photos` and the `<Photos>` grid,
with Share and Save. Selecting several photos and importing one come next.

## The plugin

```ts
// xcwds.config.ts
import camera from '@xcwds/plugin-camera';
export default defineConfig({ brand, plugins: [camera({ maxSide: 2048 })] });
```

The page gets one controller (below) as `app.camera`, made with the plugin's options, and the
plugin keeps it off whenever nobody can be using it:

- **The page is hidden** (another app, the app switcher, a locked phone): the camera turns off,
  and turns back on when the page returns only if it was on then and nothing has turned it off
  meanwhile.
- **The app locks** (with [`@xcwds/plugin-lock`](../plugin-lock/README.md), if the app has it):
  the camera stops for good, so unlocking never turns it back on; a tap does.
- **The app closes**: it stops.
- **Photos kept in the app** go in `app.photos` (below).
- **A photo is being saved**: from the shutter until the photo is encoded, an `onBeforeReload`
  reason holds app updates back. Previewing holds nothing. Hiding the page or locking the app in
  that moment waits for the photo before turning the camera off (stopping the track mid-capture
  would lose it), so the camera light can stay on for that long.

Leaving the page that shows the viewfinder stops the camera too (`<Camera>` does, when it's
destroyed, after any photo being taken). The plugin declares `network: false`.

## The viewfinder

```svelte
<script>
	import Camera from '@xcwds/plugin-camera/Camera.svelte';
</script>

<Camera onCapture={(photo) => save(photo.blob)} />
```

```css
/* app.css, after Tailwind and @xcwds/plugin-shell/styles.css */
@import '@xcwds/plugin-camera/styles.css';
```

- Nothing asks for the camera until **Turn on camera** is tapped (browsers ask for permission
  then). A blocked or missing camera shows its sentence under the picture; a blocked one also
  says where this browser keeps the setting that unblocks it (below).
- **Take photo** is a button, so Space and Enter work, enabled once the picture has its first
  frame. `onCapture` gets each photo (a JPEG with no
  metadata, see below); while it runs, the shutter waits and app updates are held back
  (`app.update.markBusy` from [`@xcwds/plugin-update`](../plugin-update/README.md), if the app
  has it).
- **Switch camera** shows when there are two or more cameras; the front camera's picture is
  mirrored, like a mirror, but its photos aren't.
- A **Zoom** slider for the camera's own zoom, or a **Digital zoom** slider without one, with a
  line saying it crops the picture and adds no detail. The picture scales to show the crop the
  photo will be. Pinching the picture with two fingers zooms too. **Light** shows when the camera has one.
- `camera` takes another controller instead of `app.camera`; `text` replaces any of the labels.

## Keeping photos

```ts
const saved = await app.photos.save(photo); // a Photo from <Camera>, or { blob, width, height }
if (!saved.ok) showError(saved.error); // storage full or blocked: keep the photo on screen
const photos = await app.photos.list(); // newest first, without their contents
```

`app.photos` keeps photos in the app's blob store (`app.blobs`), in the collection
`app:camera:photos`: group `photos`, so **Clear data** for that group removes them; personal
(`sensitive`), so a lock's reset does too; and never in backups. Each photo gets a small JPEG
thumbnail (at most 320 px on a side) saved next to it, in `app:camera:photos-thumbs` (same
group), so a list never decodes full photos.

- **`save(photo)`**: `{ ok: true, id }`, or `{ ok: false, error }` with a sentence to show when
  storage is full or blocked (no thumbnail is left behind). The first save in a session also
  asks the browser not to evict the app's data (`app.blobs.persist()`); Firefox asks the person,
  so it follows the shutter tap, and a refusal changes nothing.
- **`list()`**: `{ id, width, height, takenAt, size, type, thumb }` for each photo.
- **`get(id)`**, **`thumbnail(photo)`** (the photo itself when it has none): the `Blob`.
- **`delete(id)`**: the photo and its thumbnail; false if it couldn't.
- **`onChange(listener)`**: they were saved or deleted, here or in another tab, or cleared.

For photos that belong to one tool (a private one, say) in a group of their own, make a store over
collections of your own:

```ts
import { createPhotos } from '@xcwds/plugin-camera/photos';

// In your plugin's setup (it registers the collections, so once): app:<namespace>:photos
const notes = createPhotos(app.blobs, { label: 'Note photos', group: 'notes' });
```

## The photo grid

```svelte
<script>
	import Photos from '@xcwds/plugin-camera/Photos.svelte';
</script>

<Photos />
```

- A grid of thumbnails, newest first, that follows saves and deletes in any tab. Thumbnails load
  as they scroll into view; their object URLs are revoked when they leave it, when the photo is
  deleted and when the grid goes.
- Tapping one opens the viewer (a modal `<dialog>`): **Previous** and **Next**, the arrow keys
  or a swipe step through the photos, Escape or **Close** closes it, and **Delete** deletes the
  photo and opens the next one. **Undo** brings a deleted photo back for 8 seconds.
- **Share** hands the photo to the system share sheet (Web Share with files). Where the browser
  can't share files (Firefox on computers, older browsers) the button is **Save**, which
  downloads it, named for when it was taken (`photo-20261017-083005.jpg`). The first time a
  photo leaves the app on a page load, the viewer says so: it's now outside the app, and wherever
  it went may keep or back it up. What leaves is the clean file, with no metadata.
- While the app is locked ([`@xcwds/plugin-lock`](../plugin-lock/README.md)), nothing is rendered
  and no object URL exists; the lock's cover handles the app switcher.
- `photos` takes another store instead of `app.photos`; `text` replaces any of the labels.

### Sharing from elsewhere

`@xcwds/plugin-camera/share` has the pieces: `sharePhoto({ blob, takenAt })` shares or saves and
resolves to `shared`, `saved`, `cancelled` (the share sheet was dismissed) or `failed`, never
rejecting; `canShareFiles()` says which button to show; `fileName(photo)` and `saveFile(file)`.
Call `sharePhoto` straight from the tap, with the file already loaded: Safari only opens the share
sheet while the tap is fresh.

## The camera controller

```ts
import { createCamera } from '@xcwds/plugin-camera/camera';

// With the plugin, use `app.camera`; without it, make one:
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
// When done (and, without the plugin, when the page is hidden): every track stops and the
// camera light goes off.
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

## A blocked camera

Once someone blocks the camera, a page can't ask again or open the setting, so the most it can do
is say where it is. `blockedHelp(device)`, from `@xcwds/plugin-camera/help`, gives those steps for
the browser `device` describes (`thisDevice()` reads the page's user agent, touch points and
whether it was opened from the Home Screen):

| Browser                              | Where the setting is                                |
| ------------------------------------ | --------------------------------------------------- |
| Safari on iPhone and iPad            | aA in the address bar → Website Settings → Camera   |
| A Home Screen app on iPhone and iPad | the Settings app → Apps → Safari → Camera           |
| Chrome, Firefox or Edge on iOS       | the Settings app → that browser → Camera            |
| Chrome, Edge or Samsung on Android   | the icon left of the address → Permissions → Camera |
| Firefox on Android                   | the lock icon in the address bar → Camera           |
| Chrome or Edge on a computer         | the icon left of the address → Camera               |
| Firefox on a computer                | the crossed-out camera icon in the address bar      |
| Safari on a Mac                      | Safari → Settings → Websites → Camera               |

On Android, and on a Mac, the system can block the camera for the whole browser too, so those
steps also point at the system's settings. These are the menus as of 2026; browsers move them.

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
