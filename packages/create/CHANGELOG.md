# @xcwds/create

## 0.2.1

### Patch Changes

- New apps and `xcwds add` use the @xcwds versions released with this one.

## 0.2.0

### Minor Changes

- ef0812a: `@xcwds/plugin-lock` finishes the passcode lock: Settings → Privacy sets one up (6+ digits or a passphrase, with a backup offered first), picks what it locks (private pages or the whole app) and when it locks itself after the app is hidden (right away, 1, 5 or 15 minutes), and offers Lock now, Change passcode, Turn off and Forgot passcode. Locked pages go to a new unlock screen (`UnlockScreen.svelte`, at the `unlock` option's path, `/unlock` by default), which then opens the page that was asked for; every page load starts locked, and the page stays hidden until the app knows it isn't locked. Add `@xcwds/plugin-lock/styles.css` and an unlock route file. `@xcwds/plugin-settings` hides backup, import and clear while the app is locked, and `xcwds add lock` adds the unlock route.
- b2909f3: New `@xcwds/plugin-lock`: on private pages (`private: true` routes), a cover over the app in the app switcher and no spellcheck, autocomplete or autocapitalize in text fields, with a "Cover private pages in the app switcher" switch in Settings → Privacy. `@xcwds/plugin-settings` shows fields in the `privacy` section inside its Privacy card, and `xcwds add lock` adds the plugin.

### Patch Changes

- e1bfd28: New apps no longer start on stale versions: every release now republishes `@xcwds/create` with the versions released alongside it (#54). The generated deploy workflow builds for the root when the repository variable `CUSTOM_DOMAIN` is set, so a project site with a custom domain no longer 404s on every asset.

## 0.1.0

### Minor Changes

- 83ba8db: `npm create @xcwds`: asks for a name, tagline, icon and plugins (or `--yes`, `--template
minimal|tools`, `--plugins`) and writes a SvelteKit app wired to @xcwds, with route files for
  each plugin, tests that pass out of the box and a GitHub Pages deploy workflow. `xcwds add
<plugin>` adds a plugin to an existing app the same way.

### Patch Changes

- 7c32bdd: The generated deploy workflow gives its deploy job `contents: read`, so checkout can read the repository.
- 1d8bbc1: The repository moved to [xcwds/xcwds](https://github.com/xcwds/xcwds): package metadata, READMEs and
  the README of apps made with `npm create @xcwds` link there.
