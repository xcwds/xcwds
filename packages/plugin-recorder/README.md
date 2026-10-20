# @xcwds/plugin-recorder

Voice recordings kept on the device in an @xcwds app: the microphone is on only while recording,
nothing is sent anywhere, and nothing goes into another app's library. **Work in progress**
([#150](https://github.com/xcwds/xcwds/issues/150)): not published yet, and not a plugin you can
install yet.

So far it holds the recorder and the store the plugin will be built on. The plugin entry
(`app.recorder`, holding app updates while recording, a screen wake lock, recovering on boot) and
the `<Recorder>` and `<Recordings>` components come next.

From `@xcwds/plugin-recorder/recordings`, `createRecordings(app.blobs)` keeps recordings in the
blob store (`app:<namespace>:recordings`, and `recordings-chunks` while one is being made), both
personal (`sensitive`, so a lock's reset clears them) and out of backups. `begin(type,
recordedAt)` starts a take whose chunks are saved as they arrive, in order; `finish(name)` joins
them into one recording and deletes them, and `discard()` throws them away. If the app closes
mid-recording, the chunks stay, and `recover()` joins them into a recording marked `recovered`.
When a recording can't be saved (storage full), the chunks are kept for `recover()` too. A take
still recording in another tab is left alone: each open take holds a Web Lock (`navigator.locks`),
and `recover()` skips takes whose lock is held. Without the Locks API, it skips takes with a chunk
saved in the last 10 minutes (`staleAfter`).

From `@xcwds/plugin-recorder/recorder`, `createRecorder(recordings, options)` records from the
microphone with `getUserMedia` and `MediaRecorder`: `start()` (from a tap: browsers ask for the
microphone here), `pause()`, `resume()`, `stop(name)` and `discard()`, with `state` (`idle`,
`asking`, `recording`, `paused`, `denied`, `unavailable`, `error`), `elapsed()` (not counting
pauses), `level()` (0 to 1, for a meter, from an `AnalyserNode`) and `busy` (for `markBusy`).
A chunk is saved every 3 seconds (`timeslice`), so a crash loses at most the last few.

- **Formats differ by browser.** From `@xcwds/plugin-recorder/format`, `pickFormat` takes the
  first one `MediaRecorder.isTypeSupported` accepts: WebM/Opus (Chromium, Firefox), Ogg/Opus
  (Firefox), MP4 (Safari); with none of them, the browser picks. The type actually written is
  saved with each recording, and `extensionFor(type)` names a file for it.
- **Backgrounding.** Mobile browsers may turn the microphone off while the app is in the
  background (iOS does). When the microphone's track ends or the recorder fails mid-recording, it
  stops, saves what was recorded and says why in `notice`. It never claims to record in the
  background where it can't.
- **Voice processing.** The browser's echo cancellation, noise suppression and automatic gain stay
  on by default, which suits voice notes. The options `echoCancellation`, `noiseSuppression` and
  `autoGainControl` can turn them off; they're constraints the browser may ignore. The phone's own
  audio processing and its microphone indicator are out of the app's hands.

Everything reaches browser APIs only when a function runs, never at import time, and makes no
network requests.
