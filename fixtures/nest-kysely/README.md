# nest-kysely

Kysely hands out one connection, `Kysely<DB>`, and every query starts by naming
its table in the first argument of `selectFrom`, `insertInto`, `updateTable` or
`deleteFrom`. Nothing else in a query says which table it is about, and the
connection's type argument is the whole schema rather than one table.

That second fact is why the `kysely` record says `entityInTypeArgs: false`. A
type argument read as an entity is a name that looks like an answer and is not:
on immich, where all 579 queries are written this way, `DB` was reported as the
table of 407 of them.

| Call site | Expected table | Op | Where the name is |
|---|---|---|---|
| `db.selectFrom('asset')…` | `asset` | read | first argument of `selectFrom` |
| `db.selectFrom('asset as a')…` | `asset` | read | the alias is local to the query |
| `db.selectFrom(ASSET)…` | `asset` | read | a constant, followed like a literal |
| `db.insertInto('asset')…` | `asset` | write | first argument of `insertInto` |
| `db.insertInto('asset_exif')…` | `asset_exif` | write | first argument of `insertInto` |
| `db.updateTable('asset')…` | `asset` | write | first argument of `updateTable` |
| `db.deleteFrom('asset_metadata')…` | `asset_metadata` | delete | first argument of `deleteFrom` |
| `tx.deleteFrom(…)` / `tx.insertInto(…)` | `asset_metadata` | delete, write | a transaction is a connection by another name |
| `db.selectFrom((eb) => …)` | none, `dynamic-table-name` | read | there is no stored table in the call |
| `db.destroy()` | — | — | not an operation, so not a second query |

One node per visit to the database: `selectFrom('asset').selectAll().execute()`
is one query, and `selectAll` and `execute` are how it was built and run.
