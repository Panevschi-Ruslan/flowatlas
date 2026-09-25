# nest-drizzle

A drizzle connection is one object for the whole schema, so nothing in the
receiver's type names a table. The operation is on the call, the table is on an
expression beside it, and the `drizzle-orm` descriptor's two locators are what
put the two back together.

| Call site | Expected table | Op | Source |
|---|---|---|---|
| `db.select().from(orders).limit(20)` | `orders` | read | the `from` that follows |
| `db.select().from(orders).where(…).limit(1)` | `orders` | read | the `from` that follows |
| `db.insert(orders).values(…)` | `orders` | write | the argument |
| `db.insert(invoices).values(…)` | `invoices` | write | the argument |
| `db.update(orders).set(…).where(…)` | `orders` | write | the argument |
| `db.delete(orders).where(…)` | `orders` | delete | the argument |
| `db.delete(table)` where `table` is a parameter | none, `dynamic-table-name` | delete | — |

`orders` and `invoices` are followed back to the `pgTable('orders', …)` they
were declared as: the name a reader would see in the database is the string
there, not the name of the constant.

`from`, `where`, `set`, `values` and `limit` are not operations of the
descriptor. Each of them is one link of a builder being built, and listing them
would emit a row per link for a single visit to the database; they are counted
as external calls instead.

The stub in `node_modules/drizzle-orm` returns an intersection, because the real
library returns one: `PostgresJsDatabase<TSchema> & { $client: Sql }`. It used to
return a plain class, and that single difference of shape is why the fixture stayed
green through a defect that zeroed out a real repository's entire data layer: an
intersection carries no symbol of its own, so the receiver had no origin, no package
and no table, and every query fell back to recognising `db` by its name. A stub may
declare less than the library it stands for; it may not be a different kind of type,
because then the fixture measures the stub.

Reverting the intersection handling in `packages/core/src/origin.ts` now turns every
row of the table above into `access ?` with no operation, no table and no package,
takes both table nodes and all six `queries` edges out of the graph, and replaces the
one `dynamic-table-name` row with seven `db-receiver-name-only` ones. That is the
failure the fixture could not see before, on seven calls instead of forty-three.

The last row is the one to keep: a table decided at run time still produces a
`db_query`, because losing the whole call over one unreadable fact is what a
tool that stays quiet about what it did not understand does. The row says which
fact is missing.
