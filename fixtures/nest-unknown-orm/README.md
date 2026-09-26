# nest-unknown-orm

What a data layer nobody has described may and may not be named after.

A package with no descriptor is a package whose type parameters nobody here can
read. The call is still recorded — the receiver is typed by that package and
carries a type argument, which is more than a name — but nothing in it is a
table, and the row beside it is what a reader acts on. One descriptor turns all
four of these into tables at once.

| Call site | Expected |
|---|---|
| `this.orderRepo.find()` / `.persist()` | a query with no table, op `null`, heuristic, one `unknown-db-package` row each |
| `this.db.selectFrom('widgets')` | a query with no table and one `unknown-db-package` row. The type argument is `DB`, the whole schema; the table is the string argument |
| `this.videos.findAll()` | a query with no table and one `unknown-db-package` row. The first type argument of the base class is `AttributesOnly`, declared in `node_modules` |
| `this.localRepo.find()` | **no query node at all**, one `db-receiver-name-only` row |
| `this.jobRepository.enqueue('rebuild')` | **no query node at all**, one `db-receiver-name-only` row. It is a job queue |

`OrdersRepository` is a hand-written class that looks like a data layer and is
never read as one, so it also carries one `db-layer-unread` row naming it. That
row is the honest consequence of the one above it: nothing established that a
call through it was data access, and saying so is what a reader can act on.

## Why there are no tables here

Each of the first three used to mint one, from a value the same call site
reported as unreadable (R83):

- `table:nest-unknown-orm#Order` — the first type argument of an undescribed
  package, which nothing says is the stored entity.
- `table:nest-unknown-orm#DB` — a connection typed by the whole schema. This is
  the shape that gave immich two table nodes, `DB` and `MapDB`, with 407
  `queries` edges pointing at them and 407 rows beside them saying the package
  was not understood.
- `table:nest-unknown-orm#AttributesOnly` — a generic helper out of the
  library's own typings. This is the shape that put 1,898 of PeerTube's 1,958
  queries on one table node, so that `impact AttributesOnly` returned the whole
  server.

And the last two used to mint a `db_query` on the strength of a name. immich
names every adapter `Repository`, and 463 of the 1,153 nodes that produced there
were the job queue, the event bus, the filesystem, ffmpeg and child_process.
