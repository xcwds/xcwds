# @xcwds/plugin-qr

QR codes made and read on the device in an [@xcwds](https://github.com/xcwds/xcwds)
app. Most QR sites and apps see everything you turn into a code or scan; this one sends nothing
anywhere.

It makes codes (`<QrCode>` and `qrSvg()`, from its own encoder), reads them from still images
(`scan()`) and from the camera (`<QrScanner>`). No WASM anywhere, so the app's Content Security
Policy stays as it is. What each browser allows is in [Camera support](../../docs/camera.md).

## The plugin

```ts
// xcwds.config.ts
import camera from '@xcwds/plugin-camera';
import qr from '@xcwds/plugin-qr';
export default defineConfig({ brand, plugins: [camera(), qr()] });
```

It takes no options yet and declares `network: false`, so the build and Settings → Privacy list
it as talking to no server. `<QrScanner>` needs `@xcwds/plugin-camera` too; making codes and
`scan()` don't.

## `<QrCode>`

```svelte
<script>
	import QrCode from '@xcwds/plugin-qr/QrCode.svelte';
</script>

<QrCode value="https://example.com" class="w-64" />
```

An SVG, so it's crisp at any size: black on white whatever the theme (scanners need the
contrast), with `QR code: <value>` as what screen readers say.

- `errorCorrection`: `'L'`, `'M'` (default), `'Q'` or `'H'`, how much of the code can be damaged
  (about 7, 15, 25 or 30 percent) and still read. Higher means a denser code. The level is raised
  for free whenever the text still fits the same size.
- `margin`: the light border scanners need, in modules (default 4, as the standard asks).
- `label` replaces what screen readers say; `tooLong` replaces the message shown instead of a code
  when the text doesn't fit (more than 2,331 bytes of UTF-8 at `'M'`); `class` goes on the `<svg>`.
  An empty `value` shows nothing, since its code would scan to nothing.

## `qrSvg()` and `encodeQr()`

For pages that don't use Svelte, or a download:

```ts
import { qrSvg, encodeQr } from '@xcwds/plugin-qr/make';

const svg = qrSvg('https://example.com', { errorCorrection: 'Q', margin: 4 });
const { size, modules } = encodeQr('https://example.com'); // modules[y * size + x]: dark?
```

`qrSvg(text, options)` returns the `<svg>` as a string (the same drawing as `<QrCode>`, with
`label` and `margin` options). `encodeQr(text, options)` returns the modules, for drawing
elsewhere: `{ size, version, errorCorrection, modules }`. Both encode text as UTF-8 in byte mode,
in the smallest of the 40 versions that holds it, and throw `QrTooLongError` (a `RangeError`)
when it doesn't fit. `boost: false` keeps the error correction level you asked for.

## Downloading a code: `saveQr()` and `qrPng()`

```ts
import { saveQr } from '@xcwds/plugin-qr/make';

button.onclick = () => saveQr(text, { format: 'png' }); // qr-code.png
```

`saveQr(text, { format, name })` downloads `qr-code.svg` (the default: sharp at any size) or
`qr-code.png` (`name` replaces `qr-code`), made on the device from a `blob:` URL; call it from a
tap. `qrPng(text, { scale, margin, errorCorrection })` returns the PNG as a `Blob`, `scale` pixels
per module (default 8).

## Reading a code from an image: `scan()`

```ts
import { scan } from '@xcwds/plugin-qr/scan';

const found = await scan(file); // a File or Blob, an ImageBitmap, a canvas or ImageData
if (found) show(found.text, found.kind);
```

`scan(source, { formats })` resolves to the first code found, or `null` when there's none, and
rejects only when the image itself can't be read. `formats` defaults to `['qr_code']`.

- Where the browser has `BarcodeDetector` and it reads the format (Chrome on Android, Chromium
  on macOS), it does the work. Otherwise QR codes go to the bundled decoder
  ([jsQR](https://github.com/cozmo/jsQR), plain JavaScript) in a module Worker, on the image
  shrunk to at most 1024 px on a side, so the page stays responsive. Other formats (`ean_13`,
  `code_128`…) are read only where `BarcodeDetector` has them.
- The Worker's file isn't among what a service worker precaches (SvelteKit leaves Vite's worker
  files out of its list), so offline, before it was ever fetched, the decoder runs on the page.
- The result is `{ format, text, kind }`, plus `url`, `wifi` or `name` (a contact's) when `kind`
  says so; `wifi` is `{ ssid, security, password, hidden }`. `kind` is `url` (http and https only),
  `wifi`, `contact` (vCard or MECARD), `text`, or `other` (any other scheme: `mailto:`, `tel:`,
  `otpauth://`, a broken link). **Nothing is opened or followed**: the page decides, and the app
  sends links through its URL sanitizer. `parseQr(text)` does the same parsing on any text.

## Scanning with the camera: `<QrScanner>`

```svelte
<script>
	import QrScanner from '@xcwds/plugin-qr/QrScanner.svelte';
</script>

<QrScanner onResult={(found) => show(found)} />
```

It needs `@xcwds/plugin-camera` in the app (it uses `app.camera`, or a controller passed as
`camera`), and `@import '@xcwds/plugin-qr/styles.css';` after Tailwind for its classes.

- Nothing asks for the camera until **Scan a code** is tapped. The viewfinder is read a few times a
  second (`interval`, default 250 ms) at most 640 px on a side, one frame at a time: with
  `BarcodeDetector` where it reads the format, else the bundled decoder in one Worker that lives
  as long as the scan.
- The first code goes to `onResult` (the same `{ format, text, kind }` as `scan()`; never opened)
  and turns the camera off, unless `continuous`, which reports each new code and keeps going (a
  code still in view isn't reported again). The phone vibrates once where it can.
- Leaving the page turns the camera off, and the camera plugin turns it off while the page is
  hidden or the app locked. The sweeping line holds still for people who ask for less motion.
- `formats` as for `scan()`; `text` replaces any of its labels.
- `createReader(options)` (from `@xcwds/plugin-qr/scan`) is what it reads with: `read(source)` for
  one image after another with the same detector and Worker, and `close()` when done.
