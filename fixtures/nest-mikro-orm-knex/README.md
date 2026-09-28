# nest-mikro-orm-knex

A repository whose SQL goes through its ORM's manager: `getKnex()` on a MikroORM
`SqlEntityManager` hands back a knex instance, and every query after that call is
knex's own. Nothing under `src` imports `knex`, and the manifest does not name it.
It is the ORM's dependency, installed beside it, which is how an application that
reaches knex only through its ORM is installed.

The ORM is installed here as hand-written stubs, so the checker follows each call
into `node_modules/knex` and every query reads at `static`. What was missing was
only that the knex descriptor was never there to read them with: it was chosen by
the manifest naming `knex`, and this manifest names `@mikro-orm/postgresql`. The
step from manager to builder is now a record beside the knex descriptor
(`handovers` in `packages/adapters-db/src/descriptors/index.ts`), and a manifest
naming a package that hands knex over makes knex readable wherever a call is
traced to it. It does not make knex *detected*: a project that holds the ORM and
never calls `getKnex()` is not told the knex reader found nothing.

| Call site | Expected table | Op | How the builder is reached |
|---|---|---|---|
| `super.getActiveManager<SqlEntityManager>().getKnex()({ il: 'inventory_level' }).select(…)` | `inventory_level` | read | off the manager and invoked at once, the table as an alias object |
| `knex('inventory_level').select(…)` | `inventory_level` | read | a variable bound to `…getKnex()` |
| `knex.select('location_id').from('reservation_item')…first()` | `reservation_item` | read | `getTransactionContext() ?? getKnex()`, the table in a `from` |
| `this.em.getKnex()('inventory_level').where(…).update(…)` | `inventory_level` | write | a manager the constructor was handed |
| `knex.select('location_id').from('reservation_item')` | `reservation_item` | read | a function outside any class, the manager cast out of a context |

The first row's table is written `{ il: 'inventory_level' }`, which is knex's alias
written as an object: the key is the alias and the value is the table, exactly as
`'inventory_level as il'` is. Only one entry, and only a string value, is read as a
table; drizzle's `select({ id: users.id })` is a list of columns.

The same source with nothing installed is `nest-mikro-orm-knex-not-installed`,
and reads the same five queries and two tables at `heuristic`.
