# @xcwds/plugin-qr

QR codes made and read on the device in an [@xcwds](https://github.com/xcwds/xcwds)
app. Most QR sites and apps see everything you turn into a code or scan; this one sends nothing
anywhere. **Work in progress** ([#147](https://github.com/xcwds/xcwds/issues/147)): not
published yet.

So far it makes codes (`<QrCode>` and `qrSvg()`, from its own encoder) and reads them from still
images (`scan()`). No WASM anywhere, so the app's Content Security Policy stays as it is. Scanning
with the live camera comes next; what each browser allows for that is in
[Camera support](../../docs/camera.md).

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
- The result is `{ format, text, kind }`, plus `url`, `wifi` (`{ ssid, security, password,
hidden }`) or `name` (a contact's) when `kind` says so. `kind` is `url` (http and https only),
  `wifi`, `contact` (vCard or MECARD), `text`, or `other` (any other scheme: `mailto:`, `tel:`,
  `otpauth://`, a broken link). **Nothing is opened or followed**: the page decides, and the app
  sends links through its URL sanitizer. `parseQr(text)` does the same parsing on any text.
