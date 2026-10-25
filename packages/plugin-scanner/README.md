# @xcwds/plugin-scanner

Scan paper documents to a PDF on the device in an @xcwds app: photograph a page, straighten it,
make it readable and export the pages as one PDF, without the cloud scanning apps phones suggest.
Nothing is sent anywhere. **Work in progress**
([#151](https://github.com/xcwds/xcwds/issues/151)): not published yet, and not a plugin you can
install yet.

So far it holds the image and PDF code the plugin will be built on. Finding the page's corners,
the crop screen, the pages kept between visits (`app:scanner:pages`), the plugin entry and the
components come next.

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

Everything is pure functions that use no browser APIs and make no network requests, safe to
import anywhere.

## What it won't do

No OCR or searchable text (that needs a model the size of a small app), no automatic multi-page
capture, no signatures. No OpenCV.js either: it's several megabytes and needs WebAssembly, which
the app's Content Security Policy doesn't allow.
