# workspace-package-by-name

A workspace package imported by its own name, with nothing installed (R152).

`api` declares `@acme/stock`, so the package is part of the service's extent and
its files are opened with the service's. The controller imports it twice by
name: `@acme/stock` and `@acme/stock/levels/format`. In an installed workspace
both resolve through the link the package manager puts at
`node_modules/@acme/stock`. This fixture has no `node_modules` at all, and
`api/tsconfig.json` has no `paths`, so before R152 both imports resolved to
nothing: `this.stock` had no type, the call through it was a
`call-dynamic-receiver` row, and the route stopped at the controller.

`packages/stock/package.json` says which file each subpath is, through its
`exports` map. `.` names `./dist/index.d.ts` under `types`, which is not there on
a clone nobody has built, and `./src/index.js` under `import`, which stands for
the source `./src/index.ts` beside it. `./levels/*` is a pattern.

`@acme/ledger` is a package of the same workspace that `api` does not declare.
It is not part of the service's extent, so its files are not the service's
code, installed or not. Since P78 its name still resolves, as a package would
from an install: the workspace beside the configuration names it, so its
source is read for its types alone, at the path an install would have, and
the call through it is a call into a package, counted and not drawn.

| Expected | Why |
|---|---|
| `StockController.available -> StockService.available` | `@acme/stock` lands on `packages/stock/src/index.ts`, through the `import` condition of its `exports` map, the `types` one naming nothing on disk |
| `StockService.available -> StockLevels.count` | the package's own relative import, reached now that its entry is |
| `StockController.available -> LevelFormat.format` | `@acme/stock/levels/format` lands on `src/levels/format.ts` through the `./levels/*` pattern |
| a `package-from-repo` row for `@acme/ledger`, at `nothing`, and `this.ledger.record` under `skippedExternalCalls` | `@acme/ledger` is not declared by `api`, so it is not part of the service; its types are read from its source in the workspace beside the configuration (P78). Before R152 one `call-dynamic-receiver` row held all three calls, and until P78 it held this one |
