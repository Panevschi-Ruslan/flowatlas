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
It is not part of the service's extent, so its name stays unresolved: the
package is not the service's code, installed or not.

| Expected | Why |
|---|---|
| `StockController.available -> StockService.available` | `@acme/stock` lands on `packages/stock/src/index.ts`, through the `import` condition of its `exports` map, the `types` one naming nothing on disk |
| `StockService.available -> StockLevels.count` | the package's own relative import, reached now that its entry is |
| `StockController.available -> LevelFormat.format` | `@acme/stock/levels/format` lands on `src/levels/format.ts` through the `./levels/*` pattern |
| a `call-dynamic-receiver` row for `this.ledger.record`, one site | `@acme/ledger` is not declared by `api`, so it is not resolved by name; before R152 the same row held all three calls |
