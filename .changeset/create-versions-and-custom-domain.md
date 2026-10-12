---
'@xcwds/create': patch
---

New apps no longer start on stale versions: every release now republishes `@xcwds/create` with the versions released alongside it (#54). The generated deploy workflow builds for the root when the repository variable `CUSTOM_DOMAIN` is set, so a project site with a custom domain no longer 404s on every asset.
