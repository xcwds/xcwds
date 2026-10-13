# @xcwds/plugin-lock

Privacy for the private pages of an @xcwds app on [`@xcwds/sveltekit`](../sveltekit): pages whose
route has `private: true` (a private tool from `@xcwds/plugin-tools`, for example). It needs no
passcode; the passcode lock will build on it.

```ts
// xcwds.config.ts
import { defineConfig } from '@xcwds/core';
import lock from '@xcwds/plugin-lock';

export default defineConfig({ brand, plugins: [lock()] });
```

## What it does

- **A cover in the app switcher.** When the app is hidden on a private page, a plain cover (the
  app's icon on the page's background, no text) goes over everything, so the snapshot the app
  switcher shows doesn't show the page. It lifts as soon as the app is visible again. It's drawn
  from the browser's `visibilitychange` event itself, not the `onHidden` hook, which runs later.
  Best effort: browsers don't promise when they take the snapshot, and a private page that has
  just loaded is covered once the app has booted.
- **No spellcheck or autocomplete.** Text fields (`<textarea>` and text-like `<input>`s) in a
  private page's `<main>` get `spellcheck="false"`, `autocomplete="off"` and
  `autocapitalize="off"`, including fields added later, so tools don't have to remember. Enhanced
  spellcheck in some browsers sends what you type to a server, and autocomplete keeps it in the
  browser's form history. A field that sets one of these itself keeps its own value. The
  attributes go on when the app has booted, so fields in the prerendered page get them a moment
  after it appears.
- **Settings.** A `lock` settings field (`{ cover: boolean }`, cover on by default) adds "Cover
  private pages in the app switcher" to Settings → Privacy with `@xcwds/plugin-settings`.

## The passcode lock (in progress)

`app.lock` holds the passcode lock's state (#76). The unlock screen and the Settings controls
come next; until then nothing sets a passcode unless the app calls `setUp`.

- `state`: `enabled` (a passcode is set), `locked`, `kind` (`'digits'` or `'passphrase'`) and
  `retryAt` (when the next try is allowed). `subscribe(listener)` follows it.
- `setUp(code, kind)` sets the first passcode: 6+ digits, or a passphrase of 8+ characters. It
  resolves to a sentence saying what's wrong, or `undefined` once saved.
- `unlock(code)`, `change(current, next, kind)` and `turnOff(current)` resolve to `'ok'`,
  `'wrong'` or `'wait'`. After 5 wrong tries the next one waits 30 s, then 1 min, 5 min, 15 min
  and an hour, and the count survives a reload. `lock()` locks now.
- `reset()` is for a forgotten passcode: there's no recovery, so it clears every storage group
  marked `sensitive` (`sensitiveGroups()` lists them) along with the passcode.

Only a verifier is saved (`app:lock:verifier`: PBKDF2-SHA-256, 600,000 iterations, a random
16-byte salt), never the passcode, and unlocking lives in memory, so every start is locked. The
lock's data stays out of backups. Clearing it any other way (Settings → Your data, or another
tab) clears the sensitive groups too, so it never opens what it locked. The lock keeps people
out of the pages; it doesn't encrypt what's saved, so someone with a copy of the storage can
read it, and can try passcodes against the verifier offline (which is why short PINs aren't
allowed). The wait follows the device's clock, so moving the clock forward shortens it, and
when storage can't save, wrong tries aren't counted.

`isPrivate(app.routes, path)` says whether a path is a private page. The plugin declares
`network: false` and contacts no server.
