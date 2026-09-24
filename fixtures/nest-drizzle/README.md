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

The last row is the one to keep: a table decided at run time still produces a
`db_query`, because losing the whole call over one unreadable fact is what a
tool that stays quiet about what it did not understand does. The row says which
fact is missing.
