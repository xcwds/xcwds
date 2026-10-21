# @xcwds/plugin-recorder

Voice recordings kept on the device in an @xcwds app: the microphone is on only while recording,
nothing is sent anywhere, and nothing goes into another app's library. **Work in progress**
([#150](https://github.com/xcwds/xcwds/issues/150)): not published yet.

```ts
// xcwds.config.ts
import recorder from '@xcwds/plugin-recorder';
export default defineConfig({ brand, plugins: [recorder()] });
```

The plugin gives the app one recorder as `app.recorder` and its recordings as `app.recordings`
(`app:recorder:recordings`, group `recordings`), and looks after them whatever page is showing:

- **Updates wait** while recording, paused or saving (an `onBeforeReload` reason), so an update
  never cuts a recording short.
- **The screen stays on** while recording or paused, with a screen wake lock where the browser has
  one: a phone that locks itself would send the app to the background, where some browsers turn the
  microphone off. It's taken again when the page shows again, and let go on stop.
- **Recovery.** On boot, recordings left unfinished (the app closed mid-recording) are joined and
  kept, marked `recovered`; `app.recordings.recovered` resolves to their ids.
- **With `@xcwds/plugin-lock`**, locking the app stops and saves the recording, and `notice` says why. Recovery waits
  until the app is unlocked, and runs again on each unlock.
- **Closing** the app stops and saves the recording. Hiding the page doesn't: Android browsers keep
  recording in the background (see Backgrounding below for the ones that don't).

| Option                                                    | Default            |                                                                   |
| --------------------------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `echoCancellation`, `noiseSuppression`, `autoGainControl` | the browser's (on) | `false` turns that voice processing off (see below).              |
| `timeslice`                                               | `3000`             | How often a chunk is saved while recording, in ms (250 to 60000). |

## Components

```svelte
<script>
	import Recorder from '@xcwds/plugin-recorder/Recorder.svelte';
	import Recordings from '@xcwds/plugin-recorder/Recordings.svelte';
</script>

<Recorder />
<Recordings />
```

Import `@xcwds/plugin-recorder/styles.css` after Tailwind and `@xcwds/plugin-shell/styles.css`.

- **`<Recorder>`**: Record, then Pause or Resume, Stop and save, and Discard, with the time
  recorded and a level meter. Nothing asks for the microphone until Record is tapped. The
  recording belongs to the app, not the page, so it keeps going while another page shows. When it
  stops on its own, it says why.
- **`<Recordings>`**: the recordings, newest first, each with its name (or when it was recorded),
  date and length, and "Recovered" on one rebuilt after a crash. Play opens an `<audio>` player
  from an object URL (one at a time, revoked when closed). Rename, Share (the share sheet where
  the browser can share audio files, otherwise Save as a download, named after the recording) and
  Delete, which can be undone. Nothing shows while the app is locked.

Both take `text` to change their wording, and `recorder` or `recordings` to show something other
than `app.recorder` and `app.recordings`.

## The pieces

The pieces it's built on can also be used alone.

From `@xcwds/plugin-recorder/recordings`, `createRecordings(app.blobs)` keeps recordings in the
blob store (`app:<namespace>:recordings`, and `recordings-chunks` while one is being made), both
personal (`sensitive`, so a lock's reset clears them) and out of backups. `begin(type,
recordedAt)` starts a take whose chunks are saved as they arrive, in order; `finish(name)` joins
them into one recording and deletes them, and `discard()` throws them away. If the app closes
mid-recording, the chunks stay, and `recover()` joins them into a recording marked `recovered`.
`list()` gives them newest recorded first; `get`, `delete`, `rename` (saved again under a new id),
`restore` (for Undo) and `onChange` (this tab's changes, other tabs' and clears) do the rest.
When a recording can't be saved (storage full), the chunks are kept for `recover()` too. A take
still recording in another tab is left alone: each open take holds a Web Lock (`navigator.locks`),
and `recover()` skips takes whose lock is held. It joins each take under that lock, so two tabs
starting together never both recover one. Without the Locks API, it skips takes with a chunk
saved in the last 10 minutes (`staleAfter`).

From `@xcwds/plugin-recorder/recorder`, `createRecorder(recordings, options)` records from the
microphone with `getUserMedia` and `MediaRecorder`: `start()` (from a tap: browsers ask for the
microphone here), `pause()`, `resume()`, `stop(name)`, `interrupt(reason)` (stops and saves, with `reason` in `notice`)
and `discard()`, with `state` (`idle`,
`asking`, `recording`, `paused`, `denied`, `unavailable`, `error`), `elapsed()` (not counting
pauses), `level()` (0 to 1 for -60 dB to 0 dB, for a meter, from an `AnalyserNode`) and `busy` (for `markBusy`).
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
