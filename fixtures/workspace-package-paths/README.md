# workspace-package-paths

A workspace package that reaches its own code through an alias only its own
tsconfig defines (R141).

`api` declares `@acme/stock`, so the package is part of the service's extent and
its files are opened with the service's. Inside it, `services/stock.ts` imports
its repository as `@repositories` - the spelling every module of a real
monorepo this was found in uses for its own directories. That alias is in
`packages/stock/tsconfig.json` and nowhere else. `api/tsconfig.json` has never
heard of it.

The project is compiled with the service's tsconfig. Before R141 the import was
therefore asked of the service's `paths`, resolved to nothing, and the class
behind it was never reached: `this.levels` had no type, the call through it was
a `call-dynamic-receiver` row, and the route stopped at `StockService`. The query
in the repository was still read - its file is in the extent - but nothing led
to it.

| Expected | Why |
|---|---|
| `StockService.available -> StockLevelRepository.available` | `@repositories` is resolved with the package's own `paths`, because the importing file is the package's |
| `GET /stock/:param` reaches `stock_levels` | the whole chain, route to table, is one path now |
| no `call-dynamic-receiver` row | the receiver has a class type |

`node_modules/pg` is the same hand-written stub `nest-pg` carries.
