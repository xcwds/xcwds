# @xcwds/plugin-scanner

Scan paper documents to a PDF on the device in an @xcwds app: photograph a page, straighten it,
make it readable and export the pages as one PDF, without the cloud scanning apps phones suggest.
Nothing is sent anywhere. **Work in progress**
([#151](https://github.com/xcwds/xcwds/issues/151)): not published yet.

So far it holds the plugin entry, the crop screen, the page list with Export, the image and PDF
code it's built on, the Worker that straightens (on the GPU where it can), filters and encodes a
page, the store that keeps
a scan's pages between visits, and sharing or saving the finished scan.

## The plugin

```ts
import camera from '@xcwds/plugin-camera';
import scanner from '@xcwds/plugin-scanner';

export default defineConfig({ brand, plugins: [camera(), scanner()] });
```

One option, `collection`: the key of the blob collection that keeps the scan's pages,
`app:scanner:<collection>` (lowercase letters, digits and dashes; `pages` by default). The plugin
declares `network: false`.

The page gets `app.scanner`:

- **`pages`**: the scan in progress, the pages store described below, in `app:scanner:pages`.
- **`scan(photo, corners, { filter, max, quality, retake })`** makes the finished page from a photo
  (RGBA pixels shaped like `ImageData`) and the page's corners, in the processing Worker, and saves
  it: at the end of the scan, or in place of the page `retake` names. The photo is copied, so it
  stays usable for another crop. It resolves with `{ ok: true, id, paper }` (`paper` is `a4`,
  `letter` or `null`), or `{ ok: false, error }` with a message to show when the browser can't
  make a JPEG of the page or it can't be saved. It rejects with a `RangeError` for a request that
  can't be met, such as corners that don't make a page, so check `isConvex` first.
- **`startCorners(photo, { size })`** finds the page in a photo in the processing Worker, so a
  large photo doesn't hold up the page while the crop screen opens. It resolves with
  `{ quad, found }`: the page's corners and `found: true`, or the whole photo and `found: false`
  when nothing stands out as a page (see `findPage` below). The photo is copied, as for `scan`. It
  rejects with a `RangeError` for pixels that don't match their size or a bad `size`.
- **`busy`** is true from a `scan` call until its page is saved, and `onChange(listener)` says
  when it changes. Meanwhile an `onBeforeReload` reason ("page being scanned") holds app updates
  back, so an update never drops a page halfway.

Closing the app stops the Worker; a page it was still making resolves with an error, and corners
it was still finding reject.

## The crop screen

```svelte
<script>
	import Camera from '@xcwds/plugin-camera/Camera.svelte';
	import Crop from '@xcwds/plugin-scanner/Crop.svelte';

	let photo = $state();
	let filter = $state('original');
</script>

{#if photo}
	<Crop
		{photo}
		bind:filter
		onDone={() => (photo = undefined)}
		onCancel={() => (photo = undefined)}
	/>
{:else}
	<Camera onCapture={(p) => (photo = p.blob)} />
{/if}
```

`<Crop>` shows the photo (`photo`, a camera photo's `blob` or an image file) with four corner
handles. They start on the page `app.scanner.startCorners` finds, or on the photo's corners when
it finds none, and a line above the photo says which (and "Looking for the page…" until then).
Drag a handle, or focus it and use the arrow keys (1% of the photo's shorter side a press, 10%
with Shift); each is a 44 px button named for its corner, and a keyboard move tells screen
readers where the corner went.
Corners that cross say so beside the photo, and Add page waits until they make a page. Reset
corners puts them back where they started. The filter (Original, Greyscale, Black & white) is a
choice under the photo; bind `filter` to keep it between pages. Add page calls `app.scanner.scan`
and then `onDone({ id, paper })`; an error from it shows beside the button. Pass `retake` (a page's
id) to replace that page instead (the button says Replace page), `onCancel` for a Cancel button,
`max` to open the photo smaller than 4096 px, `scanner` to use another scanner than
`app.scanner`, and `text` to change any wording. Import
`@xcwds/plugin-scanner/styles.css` after Tailwind and `@xcwds/plugin-shell/styles.css`, so
Tailwind sees its classes.

## The page list

```svelte
<script>
	import Pages from '@xcwds/plugin-scanner/Pages.svelte';

	let retake = $state();
</script>

<Pages onRetake={(id) => (retake = id)} />
```

`<Pages>` lists the scan in progress, in order, each page with a small thumbnail (made one page
at a time, so a long scan never keeps full-size pages decoded) and Up, Down and Delete
buttons (named "Up page 2" and so on for screen readers). Delete offers Undo for a few seconds,
which puts the page back where it was. Pass `onRetake` for a Retake button: it's called with the
page's id, to hand to `<Crop>` as `retake` with the new photo. Export picks PDF (on A4 or Letter)
or one image per page, and its button says Share where the share sheet takes the files and Save
(downloads) where it doesn't. The files are made as the pages or the choices change, so the tap
goes straight to the share sheet, as Safari requires; while a change is being saved, the button
waits for the new files. Their names come from when the earliest page was last saved (a move or a
retake saves a page again). The first time a scan leaves the app it says that wherever it goes may keep it. Start
over deletes every page after a second tap. Bind `format` (`pdf` or `images`) and `paper` (`a4` or
`letter`) to keep the choices; `<Crop>`'s `onDone` gives the paper a page was snapped to, a good
default. Pass `scanner` to use another scanner than `app.scanner`, and `text` to change any
wording. While `app.lock` is locked, it renders nothing and holds no image.

## The modules

- **`@xcwds/plugin-scanner/corners`.** `findPage(pixels)` finds the corners of a page in a photo,
  where the crop screen's handles start, or returns `null` when nothing in it stands out clearly
  as a page; `startCorners(pixels)` gives `{ quad, found }`, with the whole photo when it found
  none; `frameSize(pixels, { size })` is the frame size it would search, and throws what `findPage`
  throws for pixels that don't match their size or a bad `size`. It shrinks the photo to a
  small greyscale frame (`size`, 256 px on the longer side by default, 1024 at most), splits
  page from background by brightness (Otsu's threshold), takes the largest bright region and the
  four corners that cover most of its outline, then straightens each side with a line fitted
  through the outline, so rounded or dog-eared corners land where the sides meet. It
  finds nothing when the region is under 8% or over 95% of the photo, isn't four-cornered (a
  plate), has corners sharper than 35° or flatter than 145°, or barely differs from what it's on
  (a white page on a white desk). It looks for a page lighter than what it's on. It takes about
  60 ms on a 9-megapixel photo in Node, in plain JavaScript, with no OpenCV.

- **`@xcwds/plugin-scanner/crop`.** What the crop screen does between a photo and `scan`.
  `readPhoto(blob, { max })` opens a photo as upright pixels, scaled down to `max` on its longer
  side (`OPEN_MAX`, 4096 px, by default: within the canvas iOS Safari allows, and still about
  350 dpi on A4), or gives `null` where the browser can't decode or draw it. `moveCorner` moves
  one corner, kept inside the photo. `toPhoto` turns a pointer's position on screen into the
  photo's pixels. `nudge` moves a corner one `keyStep` for an arrow key (`null` for any other
  key), and `describePoint` says where it went for a screen reader ("12% across, 30% down").
  `cropProblem(quad)` says what's wrong with corners that don't make a page (`''` when they do),
  and `CORNERS` names the corners in a `Quad`'s order. `thumbnail(page, { max })` makes the page
  list's small JPEG of a finished page (`THUMB_MAX`, 240 px, on its longer side by default), or
  `null` where the browser can't.
- **`@xcwds/plugin-scanner/geometry`.** `homography(from, to)` is the projective transform that
  maps one quad's corners onto another's (`null` when three corners are on one line), and
  `project(m, point)` applies it. A `Quad` lists a page's corners clockwise from the top left;
  `isConvex(quad)` says whether a crop is a page that can be straightened, and
  `rectangle(width, height)` is the quad of a straight one. `pageSize(quad)` sizes the
  straightened page from its longer edges, so no detail is lost, and snaps it to the exact shape
  of A4 or Letter (`PAPER`) when it's within 3% of one, since a photographed page rarely measures
  true. A page longer than `MAX_SIDE` (8192 px, the most phone canvases allow) is scaled down to
  fit.
- **`@xcwds/plugin-scanner/warp`.** `warp(pixels, quad, size)` straightens the part of an image
  inside `quad` onto a rectangle, with bilinear sampling. It takes and returns RGBA pixels shaped
  like `ImageData`, in plain JavaScript, so it runs in a Worker or without WebGL.
  `warpMatrix(pixels, quad, size)` makes the same checks and gives the homography it samples with.
- **`@xcwds/plugin-scanner/warp-gl`.** `warpGl(pixels, quad, size, { canvas })` does what `warp`
  does on the GPU, with WebGL 2 on an `OffscreenCanvas` (in a Worker too) or a `<canvas>`. It
  samples the same way, so the page matches `warp`'s to within one shade in 255, and draws it in
  strips of at most `STRIP_PIXELS` (4 megapixels), so the GPU never holds the whole page at once.
  It throws what `warp` throws, before reaching the GPU, and gives `null` where it can't run: no
  WebGL 2, a photo or page larger than this GPU's textures, or a GPU that fails. Each call makes
  its own WebGL context and gives it back when done.
- **`@xcwds/plugin-scanner/filters`.** `applyFilter(pixels, filter)` with `original`, `greyscale`
  or `bw`. Black & white is an adaptive threshold (`threshold(pixels, { radius, offset })`): each
  pixel is compared with the area around it, so a shadow across the page doesn't turn it black.
- **`@xcwds/plugin-scanner/pdf`.** `writePdf(jpegs, { paper })` writes one page per JPEG, on A4
  (the default) or Letter, landscape when the image is, each image fitted and centred. JPEGs go
  in as they are, with no re-encoding and no library. The file has no producer, author, title,
  dates or document ID, and `stripJpeg` takes the EXIF (GPS, camera, dates), XMP, ICC profiles
  and comments out of each image first (between a progressive JPEG's scans too), along with
  anything after the end of the image, such as a Motion Photo's video. Pass images that are
  already upright, as a canvas encodes them, since EXIF's orientation goes too.
- **`@xcwds/plugin-scanner/pages`.** `createPages(app.blobs, { key, label, group })` keeps the
  pages of the scan in progress in a blob collection (`app:scanner:pages` by default), so an
  unfinished scan survives a reload. Each page is the finished image, an upright JPEG with its
  size and the filter that made it. `add` puts a page at the end, `retake` replaces one's image in
  its place, `move(id, index)` reorders, `delete` removes one and `clear` starts over; `list()`
  gives them in order and `jpegs()` hands their bytes to `writePdf`. The collection is personal
  (`sensitive`, so a lock's reset clears it) and stays out of backups. The first page added asks
  the browser to keep the app's data (`persist`), since it follows a tap. A saved blob can't be
  changed, so moving or retaking a page saves a new copy and then deletes the old one; if the tab
  closes in between, the newer copy wins and the next `list()` deletes the other.
- **`@xcwds/plugin-scanner/process`.** `processPage(pixels, quad, { filter, max })` makes the
  finished page from a photo and the page's corners: sized by `pageSize` (at most `max` pixels on
  its longer side, `MAX_SIDE` by default), straightened by `warpGl` on the GPU, or by `warp`
  where it gives `null`, and passed through the filter.
  It throws a `RangeError` for corners that don't make a page, an unknown filter, a bad `max` or
  pixels that don't match their size. `createProcessor()` does the same in a Worker, started on
  first use and kept until `close()`, so a large photo never holds up the page:
  `process(pixels, quad, options)` copies the pixels over (the page keeps its own for another
  crop) and resolves with the page. It rejects with the same `RangeError` for a bad request,
  checked on the page before anything is copied. Where the Worker can't start or stops working
  (offline before its file was ever fetched, since a service worker precaches the app's pages and
  chunks but not Vite's worker files), pages are processed on the page instead. After `close()`,
  anything still waiting rejects. `finish(pixels, quad, { filter, max, quality })` goes on to
  encode the page as a JPEG, in the Worker where it has an `OffscreenCanvas` and on the page
  otherwise, and resolves with `{ blob, width, height, filter, paper }`, which the pages store's
  `add` and `retake` take as they are. It rejects with a `RangeError` for a bad `quality` too, and
  with `ENCODE_ERROR` when the browser can't make a JPEG of the page.
  `startCorners(pixels, { size })` runs `startCorners` from `./corners` in the same Worker (and
  on the page where it can't), copying the pixels over too.
- **`@xcwds/plugin-scanner/encode`.** `encodeJpeg(pixels, { quality })` encodes a finished page
  as a JPEG `Blob` (`quality` from 0 to 1, `JPEG_QUALITY`, 0.9, by default) on an
  `OffscreenCanvas`, else a `<canvas>`, and gives `null` where neither can make a JPEG (no canvas,
  a page too big for this browser's canvas, or a canvas that writes PNG instead). See-through
  pixels go on white first (`onWhite`), since JPEG has none and a canvas would make them black.
  The canvas encodes from pixels, so the JPEG carries no EXIF, and `writePdf` strips anything else.
- **`@xcwds/plugin-scanner/share`.** Takes the scan out of the app, only on the person's tap.
  `scanPdf(pages, { paper, scannedAt })` makes one PDF of the pages store's pages
  (`scan-20261027-090142.pdf`, A4 by default), and `scanImages(pages, { scannedAt })` makes one
  JPEG per page (`scan-20261027-090142-1.jpg`, …), each without metadata. Both resolve with
  `{ ok: true, files }`, or `{ ok: false, error }` with a message to show when there are no pages
  or a saved page can't be read. `shareFiles(files)` hands them to the share sheet in one go where
  the browser can share them (`canShareFiles(files)`; `canSharePdf()` to label the button Share
  or Save), and otherwise downloads each. It resolves with `shared`, `saved`, `cancelled` (the sheet was dismissed) or
  `failed`, and never rejects. `scanFiles(pages, { format, paper, scannedAt })` makes either, and
  `scannedAt(list)` is when the earliest page in `pages.list()` was last saved, for the file
  names. Safari opens the share sheet only straight from a tap, and reading
  every page takes a moment, so make the files first (when the pages change, or when an Export
  panel opens) and call `shareFiles` from the tap. `SHARE_MESSAGES.outside` is the note to show
  the first time a scan leaves the app: wherever it goes may keep or back it up.

The image and PDF modules are pure functions that use no browser APIs, and `crop`, `pages`,
`process`, `encode`, `share` and `warp-gl` reach the browser only when a method is called. None makes a network request, and all
are safe to import anywhere.

## What it won't do

No OCR or searchable text (that needs a model the size of a small app), no automatic multi-page
capture, no signatures. No OpenCV.js either: it's several megabytes and needs WebAssembly, which
the app's Content Security Policy doesn't allow.
