# Ecosystem

Every feature of an @xcwds app is a plugin. `pnpm xcwds add <name>` adds a first-party one to
an existing app; any other plugin installs like an npm package (see
[Writing a plugin](plugin-guide.md#8-use-it-in-an-app)).

## First-party plugins

Published as `@xcwds/plugin-<name>` from [xcwds/xcwds](https://github.com/xcwds/xcwds).

| Plugin                                                    | What it adds                                                                                                                                   | Contacts a server |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| [`@xcwds/plugin-shell`](../packages/plugin-shell)         | Header with the page title and back arrow, a tab bar or sidebar, toasts, Home and the error page                                               | No                |
| [`@xcwds/plugin-theme`](../packages/plugin-theme)         | Light, dark and system colour schemes, applied before first paint                                                                              | No                |
| [`@xcwds/plugin-offline`](../packages/plugin-offline)     | Precaching and runtime caching, an offline fallback page and an offline notice                                                                 | No                |
| [`@xcwds/plugin-update`](../packages/plugin-update)       | New versions wait until the user taps Update, and wait longer while something is running                                                       | No                |
| [`@xcwds/plugin-install`](../packages/plugin-install)     | An Install button where the browser offers one, Add to Home Screen steps on iPhone and iPad                                                    | No                |
| [`@xcwds/plugin-settings`](../packages/plugin-settings)   | A settings page with every plugin's settings, backups, Privacy and About                                                                       | No                |
| [`@xcwds/plugin-tools`](../packages/plugin-tools)         | An index page of small tools, pinned and recently used tools on Home, and home-screen shortcuts                                                | No                |
| [`@xcwds/plugin-timers`](../packages/plugin-timers)       | Timers that survive a sleeping phone and a reload, ring on every page and hold off updates                                                     | No                |
| [`@xcwds/plugin-share`](../packages/plugin-share)         | A Share button that shares links, never what you typed, and a private share target                                                             | No                |
| [`@xcwds/plugin-changelog`](../packages/plugin-changelog) | What's new on the settings page, with a badge on new entries and a toast after an update                                                       | No                |
| [`@xcwds/plugin-lock`](../packages/plugin-lock)           | A passcode lock for private pages (or the whole app), a cover over them in the app switcher, and no spellcheck or autocomplete in their fields | No                |

## Building blocks

| Package                                     | What it is                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| [`@xcwds/core`](../packages/core)           | The kernel: plugins, hooks, decorators, config, storage and settings           |
| [`@xcwds/sveltekit`](../packages/sveltekit) | The SvelteKit integration: Vite plugin, config, hooks, `<App>` and `persist()` |
| [`@xcwds/testing`](../packages/testing)     | Unit tests with a real app in Node, and Playwright helpers                     |
| [`@xcwds/create`](../packages/create)       | `npm create @xcwds` and `xcwds add`                                            |

## Community plugins

Community plugins are named `xcwds-plugin-<name>` and carry the `xcwds-plugin` keyword, so
[a keyword search on npm](https://www.npmjs.com/search?q=keywords%3Axcwds-plugin) finds them.
To list yours here, open a pull request that adds a row to this table.

| Plugin                                           | What it adds                                                            | Contacts a server |
| ------------------------------------------------ | ----------------------------------------------------------------------- | ----------------- |
| [`xcwds-plugin-tally`](../examples/plugin-tally) | A tally counter: the example [Writing a plugin](plugin-guide.md) builds | No                |

Plugins run with the same access as the app itself, so check what one saves and which servers
it contacts before you add it. Its `network` metadata, listed on the settings page under
Privacy, says which servers and why.
