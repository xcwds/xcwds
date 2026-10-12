# @xcwds/create

Makes a new installable, offline-first PWA on [@xcwds](https://github.com/xcwds/xcwds), from
nothing to an app on your phone:

```sh
npm create @xcwds my-app
# or
pnpm create @xcwds my-app
```

It asks for the app's name, a tagline and a square SVG icon (or uses a neutral one), and which
plugins to use. The recommended set is picked already:

| Plugin      | What it adds                                                                  |
| ----------- | ----------------------------------------------------------------------------- |
| `shell`     | Header, tab bar or sidebar, toasts, Home and the error page                   |
| `theme`     | Light and dark mode, applied before first paint                               |
| `offline`   | Works offline, with a notice when the connection drops                        |
| `update`    | New versions wait for an Update tap, never mid-task                           |
| `install`   | An Install button, or the steps on iPhone                                     |
| `settings`  | A settings page with backups, Privacy and About                               |
| `tools`     | Small tools with an index page, pinned and recent ones on Home                |
| `timers`    | Labeled timers that ring on every page and survive a sleeping phone           |
| `share`     | A Share button in the installed app (links only, never your data)             |
| `changelog` | What's new in Settings, and a toast after an update                           |
| `lock`      | A cover over private pages in the app switcher, no spellcheck in their fields |

Then it writes a SvelteKit project and installs it:

- `xcwds.config.ts` with your brand and plugins, `svelte.config.js` (`withXcwds()`), the Vite
  plugin, `hooks.server.ts` / `hooks.client.ts` and the service worker;
- the thin route files each plugin's pages need (RFC 0001, decision 2), Home, the error page,
  and an example tool with the `tools` template;
- Tailwind with each plugin's styles (`src/xcwds.css`) and the shell's notices
  (`src/lib/Notices.svelte`);
- Prettier and ESLint, a Vitest unit test, Playwright e2e tests on `@xcwds/testing` (every page,
  tap targets, the manifest, offline and no off-origin requests);
- `.github/workflows/deploy.yml`, which tests every push and deploys `main` to GitHub Pages,
  setting `paths.base` when the repository isn't `<user>.github.io`.

## Options

```sh
npm create @xcwds my-app -- --yes --template tools --name "Pocketbox"
```

| Option              | Meaning                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `--name <name>`     | The app's name (default: the directory's name)                         |
| `--tagline <text>`  | One line about it                                                      |
| `--icon <file.svg>` | A square SVG icon                                                      |
| `--template <name>` | `minimal` (the recommended plugins) or `tools` (plus tools and timers) |
| `--plugins <a,b>`   | Exactly these plugins (and what they need)                             |
| `-y`, `--yes`       | Ask nothing; defaults for the rest                                     |
| `--no-install`      | Skip installing                                                        |

## Adding a plugin later

The new app depends on this package, which also has the `xcwds` command:

```sh
pnpm xcwds add timers     # or: npx xcwds add timers
pnpm xcwds add            # lists the plugins, ticking the ones you have
```

`xcwds add` does for an existing app what creating it would have: adds the dependency, the
config entry (and its tab in the shell's `sections`, before Settings), the plugin's route files
(never over yours), and refreshes `src/xcwds.css` and `src/lib/Notices.svelte`. Those two say
they're managed; once you edit one so it no longer does, `xcwds add` leaves it alone and tells
you what to add by hand. It then runs your package manager's install (`--no-install` skips it).

## In this repository

`pnpm test:starter` generates the `tools` template into `examples/starter` (git-ignored) with
`--workspace`, which depends on these packages with `workspace:*` instead of npm, adds two
plugins with `xcwds add`, and runs the app's own check, lint, unit and e2e tests. CI runs it on
every pull request. Versions in generated apps come from this monorepo when the package builds
(`scripts/versions.js`), so every release republishes this package too: `pnpm version-packages`
first runs `scripts/release-create.js`, which adds a patch changeset for `@xcwds/create` whenever
another package is being released.
