---
'@xcwds/plugin-camera': patch
---

`capture()` takes the viewfinder's frame when `ImageCapture.takePhoto()` gives no Blob, as the older draft that Firefox's `dom.imagecapture.enabled` turns on does, instead of relying on `createImageBitmap` to reject.
