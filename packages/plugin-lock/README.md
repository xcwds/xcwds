# @xcwds/plugin-lock

Privacy for the private pages of an @xcwds app on [`@xcwds/sveltekit`](../sveltekit): pages whose
route has `private: true` (a private tool from `@xcwds/plugin-tools`, for example). A passcode
lock keeps people out of them (or out of the whole app), and two protections need no passcode.

```ts
// xcwds.config.ts
import { defineConfig } from '@xcwds/core';
import lock from '@xcwds/plugin-lock';

export default defineConfig({ brand, plugins: [lock()] });
```

```svelte
<!-- src/routes/unlock/+page.svelte -->
<script lang="ts">
	import UnlockScreen from '@xcwds/plugin-lock/UnlockScreen.svelte';
</script>

<main class="page-narrow pt-2 pb-6"><UnlockScreen /></main>
```

```css
/* After Tailwind and @xcwds/plugin-shell/styles.css */
@import '@xcwds/plugin-lock/styles.css';
```

Options: `unlock`, the unlock screen's path (default `/unlock`). The plugin adds it to the
route registry, titled "Locked" and not private, so it never needs unlocking.

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
- **Settings.** The `lock` settings field: `cover` (on by default), `scope` (`'private'` or
  `'app'`) and `autoLockMinutes` (0, 1, 5 or 15; default 1). With `@xcwds/plugin-settings`,
  Settings → Privacy shows the cover switch and the passcode lock's controls
  (`LockSettings.svelte`).

## The passcode lock

People set it up in Settings → Privacy, which says that a forgotten passcode can't be recovered
and offers a backup first (not encrypted). Then:

- **What it locks.** Private pages, or the whole app (every page but the unlock screen). An
  `onNavigate` guard sends a locked page to the unlock screen and remembers, in memory only,
  where it was going; after unlocking, that page opens. Locking while on a locked page hides it
  and shows the unlock screen in its place.
- **When it locks.** Lock now in Settings; after the app has been hidden for `autoLockMinutes`
  (0 locks as soon as it's hidden); and on every page load, since unlocking lives in memory.
  While a passcode is set, a head script hides each page from its first paint
  (`data-xcwds-locked` and `visibility: hidden` on `<html>`) until the app has booted and knows
  whether the page is locked. If the app fails to boot, the page stays hidden. A timer on a page
  that gets locked keeps running (timers count wall-clock time).
- **While locked**, Settings → Privacy offers only Unlock and Forgot passcode, and
  `@xcwds/plugin-settings` offers no backup, import or clear.
- **Forgot passcode**, on the unlock screen and in Settings, resets the lock and clears every
  storage group marked `sensitive`, after two confirmations that name them. It offers no backup:
  one made while locked would hand over what the lock keeps out.

The API:

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

`app.lockScreen` has the unlock screen's `path` and `next()`, where to go after unlocking.
`isPrivate(app.routes, path)` says whether a path is a private page, and
`needsUnlock(app.routes, path, scope, unlockPath)` whether a locked app keeps it behind the
unlock screen. The plugin declares
`network: false` and contacts no server.
