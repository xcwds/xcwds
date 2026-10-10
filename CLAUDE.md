# Agent notes

@xcwds is a Fastify-style, plugin-based framework for private, offline-first PWAs, extracted from
[xcwds.github.io](https://github.com/xcwds/xcwds.github.io). Plan: epic #1 with milestones per
phase. Design: `docs/rfc/0001-architecture.md`; follow its decisions, and change the RFC in the
same PR when a decision changes.

pnpm monorepo: `packages/*` are published under the `@xcwds` scope, `examples/*` are test apps.
Never publish to npm unless the user asks.

- Before pushing: `pnpm build && pnpm check && pnpm lint && pnpm publint && pnpm test:unit --run && pnpm test:e2e`,
  plus `pnpm test:starter` when a generated app could change (`packages/create`, or any package it uses).
- In Claude Code cloud containers don't run `playwright install`; set
  `CHROMIUM_PATH=/opt/pw-browsers/chromium-*/chrome-linux/chrome` (the version that exists).
- The kernel (`@xcwds/core`) stays framework-agnostic: no Svelte, no DOM-framework imports, and no
  browser globals at import time (client code is imported during prerender).
- Never phone home: no telemetry, no network calls in any package unless a plugin declares them.
- Plugin options must be JSON-serialisable (RFC decision 1).
- Always open a PR against `main` linking the issues it closes (write "Closes #n" for each one).
  Review it adversarially, post the review on GitHub, fix and re-review (at most 3 rounds), then
  squash-merge once CI is green, unless the user says not to.
- Add a changeset for changes to a package. Releases go through `.github/workflows/release.yml`
  (see `.changeset/README.md`); never run `changeset publish` or `npm publish` yourself.
- Docs: guides in `docs/`, package READMEs, rendered by the docs site in `site/` (deployed by
  `.github/workflows/docs.yml` after CI passes on `main`). Keep links relative file links. When a
  file in `examples/plugin-tally` changes, copy it into `docs/plugin-guide.md` (a site unit test
  compares them); new first-party plugins go in `docs/ecosystem.md` and `PACKAGES` in
  `site/src/lib/server/pages.ts`.
