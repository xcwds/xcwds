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

`isPrivate(app.routes, path)` says whether a path is a private page. The plugin declares
`network: false` and contacts no server.
