# Getting started

An @xcwds app is a static site that installs like an app, works offline and keeps what people
save on their own device. You describe it in one config file: its name, icon and colours, and a
list of plugins. This page takes you from nothing to an app on your phone.

## Make an app

```sh
npm create @xcwds my-app
# or
pnpm create @xcwds my-app
```

It asks for a name, a one-line tagline, a square SVG icon (or uses a neutral one) and which
plugins to use, with the recommended ones ticked: the shell (header, tab bar and Home), light
and dark mode, offline support, updates that wait for a tap, an Install button and a settings
page. `--template tools` adds a list of small tools and timers. Then it installs everything.

```sh
cd my-app
pnpm dev          # http://localhost:5173
```

## What you get

| File                           | What it is                                                         |
| ------------------------------ | ------------------------------------------------------------------ |
| `xcwds.config.ts`              | The app's brand and plugins. Most changes start here.              |
| `src/routes/`                  | Pages. A plugin's page is a small file that renders its component. |
| `src/xcwds.css`                | Each plugin's styles, kept in sync by `xcwds add`.                 |
| `src/lib/Notices.svelte`       | The notices plugins show (offline, update), also kept in sync.     |
| `e2e/app.test.ts`              | Playwright tests: every page, tap targets, offline, no tracking.   |
| `.github/workflows/deploy.yml` | Tests every push and deploys `main` to GitHub Pages.               |

It is an ordinary [SvelteKit](https://svelte.dev/docs/kit) project, built with
`@sveltejs/adapter-static`: you add pages the usual way.

## The config file

```ts
// xcwds.config.ts
import { defineConfig } from '@xcwds/core';
import settings from '@xcwds/plugin-settings';
import shell from '@xcwds/plugin-shell';
import theme from '@xcwds/plugin-theme';

export default defineConfig({
	brand: {
		name: 'Pocketbox',
		tagline: 'Everyday tools.',
		icon: 'icon.svg',
		themeColor: { light: '#ffffff', dark: '#0f172a' }
	},
	plugins: [
		shell({
			sections: [
				{ path: '/', label: 'Home', emoji: '🏠' },
				{ path: '/settings', label: 'Settings', emoji: '⚙️' }
			]
		}),
		theme(),
		settings()
	]
});
```

- **`brand`** names the app everywhere it shows: the page title, the home-screen label, the
  manifest. `icon` is rendered into every icon size browsers and phones ask for.
- **`plugins`** is the list of features, in order. Calling a plugin returns a small, plain
  description of it (its package name and options), so options must be plain data: strings,
  numbers, booleans, arrays and objects. The build checks them and names the plugin when one
  is wrong.
- **`privacy.allowOrigins`** lists any server the app may contact that no plugin declares. It is
  empty by default, and the build fails if it finds a call to any other server. See
  [Privacy](privacy.md).
- **`manifest`** adds fields to the generated web app manifest. **`storage.prefix`** changes
  the `app:` prefix of saved keys, and **`storage.appName`** the name backups carry (and must
  carry to import), which defaults to `brand.name`: set it to keep importing backups an app made
  under another name.

## Add a plugin

```sh
pnpm xcwds add timers
```

`xcwds add` installs the package, adds it to `xcwds.config.ts` (and its tab before Settings),
writes the pages it needs and updates `src/xcwds.css` and `src/lib/Notices.svelte`. Run
`pnpm xcwds add` on its own to see every plugin, with the ones you have ticked. The
[ecosystem](ecosystem.md) page lists them all, and [Writing a plugin](plugin-guide.md) shows how
to make your own.

## Deploy to GitHub Pages

1. Push the app to a GitHub repository.
2. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`. The workflow runs the tests, builds and deploys.

A repository named `<user>.github.io` is served from the root. Any other repository is a
project site under `/<repo>`, so the workflow sets `BASE_PATH` for the build and every link,
the manifest and the service worker follow it. Other static hosts work too: deploy the `build/`
folder and serve `404.html` for unknown paths.

## Check that it works

- **Install it.** Open the deployed site on your phone. On Android, tap Install in Settings (or
  the browser's menu); on iPhone, Settings shows the Share → Add to Home Screen steps.
- **Go offline.** Turn on airplane mode and open the app: every page still loads.
- **Update it.** Push a change. The open app offers Update and only reloads when you tap it,
  so nobody loses what they were doing.

Next: [Concepts](concepts.md) explains how the pieces fit together.
