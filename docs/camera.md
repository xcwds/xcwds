# Camera support

What each browser lets a page do with the camera, for
[`@xcwds/plugin-camera`](../packages/plugin-camera/README.md) and the plugins that build on it
([#142](https://github.com/xcwds/xcwds/issues/142)), and with the microphone, for
[`@xcwds/plugin-recorder`](../packages/plugin-recorder/README.md) ([#150](https://github.com/xcwds/xcwds/issues/150)). Published compatibility data disagrees with
itself here, so each cell says where it comes from:

- **✅ checked**: run in that browser, at the version given.
- **📚 sources**: what the linked sources say, not yet checked on a device.
- **📱 check**: the sources don't settle it; it needs a check on a real phone or computer.

Firefox and Chrome on iOS are built on WebKit (Apple requires it), so they behave like the Safari
column, except that only Safari can add a page to the Home Screen.

## The matrix

| Feature                                                                      | Chrome, Android                                         | Firefox, Android                                      | Safari, iOS (browser · Home Screen app)                       | Chrome, computer                                                          | Firefox, computer                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`getUserMedia`][gum] video                                                  | 📚 yes                                                  | 📚 yes                                                | 📚 yes · 📚 yes since iOS 13.4                                | ✅ yes (Chromium 156, Linux)                                              | ✅ yes (Firefox 158, Linux)                                                                                          |
| [`facingMode`][facing] front / back                                          | 📚 yes                                                  | 📚 yes                                                | 📚 yes                                                        | 📚 webcams usually report none; ✅ none on the fake camera (Chromium 156) | 📚 webcams usually report none; ✅ `environment` on the fake camera (Firefox 158)                                    |
| Switching cameras without a new prompt                                       | 📱 check                                                | 📱 check                                              | 📱 check                                                      | 📱 check                                                                  | 📱 check                                                                                                             |
| Permission remembered                                                        | 📚 yes, per site                                        | 📱 check                                              | 📱 check (Home Screen apps reported to ask again each launch) | 📚 yes, per site                                                          | 📱 check                                                                                                             |
| Largest stream, `width`/`height` `ideal` 4096                                | 📱 check                                                | 📱 check                                              | 📱 check                                                      | ✅ the camera's largest (3840 × 2160 from the fake camera, Chromium 156)  | ✅ the camera's largest (4096 × 2160 from the fake camera, Firefox 158)                                              |
| Largest stream, no constraints                                               | 📱 check                                                | 📱 check                                              | 📱 check                                                      | ✅ 640 × 480 (Chromium 156, fake camera)                                  | ✅ 640 × 480 (Firefox 158, fake camera)                                                                              |
| [`getCapabilities()`][caps], `getSettings()`, `applyConstraints()`           | 📚 yes                                                  | 📱 check (`getCapabilities` is newer here)            | 📚 yes                                                        | ✅ yes (Chromium 156)                                                     | ✅ yes (Firefox 158)                                                                                                 |
| [Image Capture constraints][spec]: `zoom`, `pan`, `tilt`                     | 📚 `zoom` on cameras that have it ([web.dev][ptz])      | 📚 no ([1419688][bz-zoom])                            | 📱 check                                                      | 📚 pan/tilt/zoom webcams ([web.dev][ptz]); ✅ none on the fake camera     | 📚 no ([1419688][bz-zoom]); ✅ none on the fake camera (Firefox 158)                                                 |
| `torch`                                                                      | 📚 yes, back camera                                     | 📚 no ([888177][bz-ic])                               | 📱 check                                                      | 📚 webcams have none                                                      | 📚 no ([888177][bz-ic]); ✅ none on the fake camera (Firefox 158)                                                    |
| `focusMode`, `focusDistance`, `exposureMode`, `whiteBalanceMode`             | 📚 where the camera has them                            | 📚 no ([888177][bz-ic])                               | 📱 check                                                      | ✅ focus and exposure from the fake camera (Chromium 156)                 | 📚 no ([888177][bz-ic]); ✅ none on the fake camera (Firefox 158)                                                    |
| [`ImageCapture`][ic]: `takePhoto`, `grabFrame`, `getPhotoCapabilities`       | 📚 yes                                                  | 📱 check (`dom.imagecapture.enabled`, off by default) | 📚 no                                                         | ✅ yes (Chromium 156)                                                     | ✅ no; `dom.imagecapture.enabled` gives an old draft: `takePhoto()` only, the photo in a `photo` event (Firefox 158) |
| [`BarcodeDetector`][bd] and `getSupportedFormats()`                          | 📚 yes                                                  | 📚 no                                                 | 📱 check (sources disagree)                                   | 📚 macOS and ChromeOS only; ✅ none on Linux (Chromium 156)               | ✅ no (Firefox 158)                                                                                                  |
| [`createImageBitmap`][cib] with `imageOrientation: 'from-image'`             | 📚 yes                                                  | 📚 yes                                                | 📱 check                                                      | ✅ yes (Chromium 156)                                                     | ✅ yes (Firefox 158)                                                                                                 |
| [`OffscreenCanvas`][oc]                                                      | 📚 yes                                                  | 📚 yes                                                | 📚 yes since Safari 16.4                                      | ✅ yes (Chromium 156)                                                     | ✅ yes (Firefox 158)                                                                                                 |
| [`canvas.toBlob`][tb] `image/jpeg` · `image/webp`                            | 📚 yes · yes                                            | 📚 yes · yes                                          | 📚 yes · no (it falls back to PNG)                            | ✅ yes · yes (Chromium 156)                                               | ✅ yes · yes (Firefox 158)                                                                                           |
| [`navigator.storage.persist()`][persist]                                     | 📚 granted silently or refused, by how the site is used | 📱 check                                              | 📱 check                                                      | 📚 granted silently or refused, by how the site is used                   | 📚 asks with a prompt                                                                                                |
| The stream when the page is hidden, the phone locks, and the app is reopened | 📱 check                                                | 📱 check                                              | 📱 check                                                      | 📱 check                                                                  | 📱 check                                                                                                             |
| [Web Share with files][share] (`canShare({ files })`)                        | 📚 yes                                                  | 📱 check                                              | 📚 yes                                                        | 📚 Windows, ChromeOS and macOS; ✅ no Web Share on Linux (Chromium 156)   | ✅ no Web Share on Linux (Firefox 158); 📱 check Windows                                                             |
| Manifest [`share_target`][target] with files                                 | 📚 yes, for installed apps                              | 📚 no                                                 | 📚 no                                                         | 📱 check                                                                  | 📚 no                                                                                                                |

Whatever a cell says, the plugin checks the feature at run time rather than by browser: no
hardware zoom means an honestly labelled digital zoom, no `ImageCapture` means a frame from the
video, no Web Share with files means Save.

### Microphone and recording

| Feature                                                              | Chrome, Android                       | Firefox, Android         | Safari, iOS (browser · Home Screen app)                                | Chrome, computer                                                            | Firefox, computer                          |
| -------------------------------------------------------------------- | ------------------------------------- | ------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| [`getUserMedia`][gum] audio                                          | 📚 yes                                | 📚 yes                   | 📚 yes · 📱 check (may ask on every launch)                            | ✅ yes (Chromium 156, Linux)                                                | ✅ yes (Firefox 158, Linux)                |
| `echoCancellation`, `noiseSuppression`, `autoGainControl` turned off | 📚 yes                                | 📚 yes                   | 📱 check                                                               | ✅ yes, all three (Chromium 156)                                            | ✅ yes, all three (Firefox 158)            |
| [`MediaRecorder`][mr] [types][mr-type]: WebM/Opus · Ogg/Opus · MP4   | 📚 yes · no · yes since Chrome 126    | 📚 yes · yes · no        | 📚 no · no · yes (AAC); 📱 check WebM, which newer versions may record | ✅ yes · no · yes, Opus in MP4 (Chromium 156)                               | ✅ yes · yes · no (Firefox 158)            |
| Chunks every `timeslice`, joined into one file that plays            | 📚 yes                                | 📚 yes                   | 📱 check (MP4 chunks are only playable joined)                         | ✅ yes (Chromium 156)                                                       | ✅ yes (Firefox 158)                       |
| `<audio>` [plays][cpt] WebM/Opus · Ogg/Opus · MP4 AAC                | 📚 yes · yes · yes                    | 📚 yes · yes · yes       | 📱 check · 📱 check · 📚 yes                                           | ✅ yes · yes (Chromium 156) · 📚 yes in Chrome, no in plain Chromium builds | ✅ yes · yes (Firefox 158) · 📚 yes        |
| The microphone when the page is hidden or the phone locks            | 📱 check (reported to keep recording) | 📱 check                 | 📱 check (reported to stop: the plugin saves and says so)              | 📚 keeps recording                                                          | 📚 keeps recording                         |
| [Screen Wake Lock][wake]                                             | 📚 yes                                | 📚 yes since Firefox 126 | 📚 yes since Safari 16.4 · 📱 check                                    | ✅ yes (Chromium 156)                                                       | ✅ yes (Firefox 158), 📚 since Firefox 126 |
| [Web Locks][locks] (`navigator.locks`)                               | 📚 yes                                | 📚 yes                   | 📚 yes since Safari 15.4                                               | ✅ yes (Chromium 156)                                                       | ✅ yes (Firefox 158)                       |
| [Web Share][share] with audio files                                  | 📚 yes                                | 📱 check                 | 📚 yes                                                                 | 📚 as for photos; ✅ no Web Share on Linux (Chromium 156)                   | ✅ no Web Share on Linux (Firefox 158)     |

The recorder checks these at run time too: it takes the first type `MediaRecorder` accepts (WebM,
then Ogg, then MP4) and saves the type it got with each recording, a recording that stops on its
own is saved with a sentence saying why, and no Web Share with files means Save.

### How the ✅ cells are checked

`examples/minimal/e2e/camera-support.test.ts` runs the probes in Playwright's Chromium with its
fake camera and microphone (`--use-fake-device-for-media-stream`) and fails when a ✅ cell above
stops being true.
It is a smoke test of what the plugin relies on, not proof of what a real camera does: the fake
camera has no zoom, torch or facing, and headless Linux has no Web Share or `BarcodeDetector`.

The Firefox cells come from the same probes in `examples/minimal/e2e-firefox/`, run in an
installed Firefox with its fake camera and microphone (`media.navigator.streams.fake`):
`FIREFOX_PATH=/usr/bin/firefox pnpm test:firefox`. It drives Firefox over WebDriver BiDi
(Playwright's experimental `moz-firefox` channel) with whichever version is installed, so it
isn't part of `pnpm test:e2e` or CI: run it when you change a Firefox cell, and give the version
it ran. Firefox's fake camera does report a facing (`environment`), unlike Chromium's.

### Still to check on devices

Every 📱 cell, and the 📚 ones for the phones, need a real device. The ones that change what the
plugins do come first:

1. Safari on iOS: Image Capture constraints (`zoom`, `torch`), `BarcodeDetector`, and whether a
   Home Screen app asks for the camera on every launch.
2. Firefox on Android: `getCapabilities()`, and what `dom.imagecapture.enabled` turns on today
   (on a computer it's an old draft with `takePhoto()` only, which the camera plugin skips for
   the viewfinder's frame, since it gets no photo back).
3. Every phone: what happens to the stream when the page is hidden, the phone locks, and the app is
   reopened; the largest stream with and without `ideal` constraints.
4. Safari on iOS: which types `MediaRecorder` records and `<audio>` plays, the voice processing
   switches, and the microphone in the background (with a Home Screen app too).

## What the page can't control

The plugins control the network (none), the photo's metadata, where photos live, and when the
camera is on. They can't reach:

- **The image signal processor.** The phone processes every frame (HDR, sharpening, face and scene
  detection) before the browser sees it, and no web API turns that off.
- **The operating system's camera indicator and prompts.** The green dot or camera light and the
  permission prompts belong to the system and the browser.
- **The browser itself.** What it logs, syncs or reports is its own business; pick one you trust.
- **Anything after a share.** A shared or saved photo is outside the app: the gallery, a chat or a
  cloud backup may keep it, copy it or read it.

## Zoom in Firefox

Firefox has never implemented the Image Capture spec, where `zoom`, `pan`, `tilt`, `torch` and
`focusDistance` live ([888177][bz-ic], [1419688][bz-zoom]), so a page in Firefox gets the picture
but no zoom control. No extension can fix that: extensions can't reach the camera or the media
pipeline, and scaling the page's `<video>` with CSS is only a picture of a zoom. The plugin gives
Firefox (and every browser without hardware zoom) a digital zoom that crops the photo, labelled as
such.

On a computer, a USB (UVC) webcam keeps pan, tilt and zoom as device controls that carry into
every app, so Firefox gets an already-zoomed picture:

- **Linux**: `v4l2-ctl -d /dev/video0 --list-ctrls` lists them, then
  `v4l2-ctl -d /dev/video0 --set-ctrl=zoom_absolute=200` zooms (the range is in the list).
- **Windows**: the webcam maker's utility, or a generic UVC control utility.
- **macOS**: the webcam maker's utility.

Phones have no such workaround: Firefox for Android has the same limit, and Firefox on iOS is
WebKit, so it behaves like Safari.

[gum]: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
[facing]: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/facingMode
[caps]: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities
[spec]: https://w3c.github.io/mediacapture-image/
[ptz]: https://web.dev/articles/camera-pan-tilt-zoom
[ic]: https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture
[bd]: https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
[cib]: https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
[oc]: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
[tb]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
[persist]: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
[share]: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare
[target]: https://developer.mozilla.org/en-US/docs/Web/Manifest/share_target
[bz-ic]: https://bugzilla.mozilla.org/show_bug.cgi?id=888177
[bz-zoom]: https://bugzilla.mozilla.org/show_bug.cgi?id=1419688
[mr]: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
[mr-type]: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static
[cpt]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/canPlayType
[wake]: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
[locks]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
