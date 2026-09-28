# nest-workspace-wrapper

A data layer of the project's own, kept in a workspace package beside the
service: `api` reaches its database only through `@acme/db`, and `@acme/db` wraps
a driver nothing here describes. It is the case `nest-prisma-wrapper` is not.
That fixture's wrapper re-exports a library's client, so every type it hands on
is still the library's own and the descriptor is found with no configuration at
all. This one's wrapper declares classes of its own, and no descriptor can
reach those.

So neither call is read as data access, and nothing here should read it as one
without being told. Two rows say so, one per reason that already exists, and
both name `@acme/db`, because the fix is in configuration and is about that
package rather than about `api`:

| Call site | Reason | What the row names |
|---|---|---|
| `db.findOrders()` | `db-receiver-name-only` | `Database`, declared by the workspace package `@acme/db` |
| `this.orders.findAll()` | `db-layer-unread` | `OrdersRepository`, declared by the workspace package `@acme/db` |

The package is resolved the way a workspace resolves it: through a link, so the
checker lands on `packages/db/src/index.ts` with no `node_modules` in the path
and reads the type as the project's own. Here the link is a `paths` entry in
`api/tsconfig.json`. Before R97 the first row said `Database` was "declared in
this repository", which of `api` is false, and neither row said where to look.

Naming both classes under `adapters.db.localBaseClasses` turns each call into a
`db_query` read with `package` `local:<class>` and leaves no data-layer row.
That is checked by hand rather than here, since a fixture has one
configuration and this one holds the rows.
