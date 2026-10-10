# @xcwds/create

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
