# Contributing

Requirements: Node (the version in `.tool-versions`, or `mise install`) and pnpm (`corepack enable`).
Or open the repo in its dev container (`.devcontainer/`, e.g. VS Code's "Reopen in Container"),
which has both plus Playwright's Chromium, isolated from your machine.

```sh
pnpm install
pnpm build          # build the packages (examples import their output)
pnpm check          # type check every package and example
pnpm lint           # prettier + eslint
pnpm test:unit --run
pnpm test:e2e       # builds examples/minimal and site/ at the root and under a base path, then runs Playwright
pnpm test:starter   # generates an app with npm create @xcwds into examples/starter and tests it
pnpm test:firefox   # checks docs/camera.md's Firefox cells in an installed Firefox (FIREFOX_PATH)
```

Before pushing, run `pnpm build && pnpm check && pnpm lint && pnpm publint && pnpm test:unit --run`
and, if you touched anything the examples use, `pnpm test:e2e` (and `pnpm test:starter` for
anything a generated app uses, including `packages/create`).

- Playwright needs Chromium: `pnpm --filter @xcwds/example-minimal exec playwright install chromium`,
  or point `CHROMIUM_PATH` at a Chromium binary you already have.
- `pnpm test:firefox` isn't part of the pre-push checks or CI. It runs only when you change a
  Firefox cell of `docs/camera.md` or the probes behind it, in your own Firefox
  (`FIREFOX_PATH=/usr/bin/firefox`; without it Playwright looks for `/snap/bin/firefox` on Linux).
- e2e tests use `@xcwds/testing/playwright` (its config preset, `gotoHydrated`, the GitHub
  Pages-like server, the tap-target audit) and block service workers unless a test opts in with
  `test.use({ serviceWorkers: 'allow' })`.
- Add a changeset (`pnpm changeset`) to PRs that change a package.
- Docs live in `docs/` and each package's README; `site/` renders them (`pnpm --filter
@xcwds/site dev`). Links between them are relative file links, which work on GitHub and the
  site alike. The plugin guide shows `examples/plugin-tally`'s files in full: when you change
  one, copy it into `docs/plugin-guide.md` (a unit test compares them). Renovate leaves its
  `package.json` alone for that reason, so bump its dependencies by hand, with the guide.
  Reference pages list each plugin's options, decorators and settings from its types, so
  document those with doc comments.
- Design changes go through an RFC in `docs/rfc/`.
- CI also runs the build, unit tests and `pnpm test:starter` on Node 22.18, the oldest Node the
  packages' `engines` allow; raise that job's `node-version` together with `engines`.
- Workflows pin every action to a commit SHA with its version in a comment
  (`uses: actions/checkout@<sha> # v7.0.1`); Renovate keeps both up to date. Give a new job only
  the `permissions` it needs.

## Agent workflows

`.github/workflows/agent.yml` is the shared runner for the agent routines (Claude Code on GitHub
Actions, [#199](https://github.com/xcwds/xcwds/issues/199)); `.github/agents/` holds their prompts
and scripts, tested by the `agents` vitest project. Nothing runs on a schedule yet. What runs where,
the secrets and variables, and the owner's setup steps are in
[AGENTS.md](AGENTS.md#agent-workflows).
