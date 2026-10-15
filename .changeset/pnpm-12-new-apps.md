---
'@xcwds/create': patch
---

New apps allow esbuild's install script in `pnpm-workspace.yaml`, so `pnpm install` works with pnpm 11 and 12 (which ignore package.json's `pnpm` field) as well as pnpm 10.
