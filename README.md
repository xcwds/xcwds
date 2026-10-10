# @xcwds

Everyday tools that never phone home, as a framework: make your own installable, offline-first
PWA from a config file and a list of plugins. Modelled on [Fastify](https://fastify.dev)'s
plugin system and extracted from [xcwds.github.io](https://github.com/xcwds/xcwds.github.io).

On npm as `@xcwds/*` (0.x, so a minor release can still change APIs). The plan is [#1](https://github.com/xcwds/xcwds/issues/1)
and the design is [RFC 0001](docs/rfc/0001-architecture.md).

## Docs

- [Getting started](docs/getting-started.md): from nothing to an app on your phone
- [Concepts](docs/concepts.md): plugins, hooks, decorators, saved data, updates and privacy
- [Writing a plugin](docs/plugin-guide.md): build, test and use a plugin of your own
- [Ecosystem](docs/ecosystem.md): every plugin
- [Privacy](docs/privacy.md): how the framework keeps apps from phoning home

The same pages, with a reference for every package, are a docs site built with @xcwds itself
(`site/`), deployed to GitHub Pages from `main` at [docs.xcwds.com](https://docs.xcwds.com).

## Packages

| Package                                  | What it is                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| [`@xcwds/core`](packages/core)           | The kernel: plugins, hooks, decorators, config, storage, settings         |
| [`@xcwds/sveltekit`](packages/sveltekit) | The SvelteKit integration: Vite plugin, config, hooks, `<App>`, `persist` |
| [`@xcwds/testing`](packages/testing)     | Test kit: `buildTestApp()` for Vitest, Playwright helpers and presets     |
| [`@xcwds/create`](packages/create)       | `npm create @xcwds`: a new app in one command, and `xcwds add <plugin>`   |

## Repository

- `packages/*`: published packages, all under the `@xcwds` npm scope
- `examples/minimal`: the smallest working app, used by the e2e tests
- `examples/plugin-hello`: a tiny plugin with every kind of entry, used by `examples/minimal`
- `examples/plugin-tally`: the plugin [Writing a plugin](docs/plugin-guide.md) builds
- `docs/`: the guides, and design decisions in `docs/rfc`
- `site/`: the docs site, which renders `docs/` and each package's README

See [CONTRIBUTING.md](CONTRIBUTING.md) to build and test.

## License

[MIT](LICENSE)
