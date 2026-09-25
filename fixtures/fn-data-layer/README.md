# fn-data-layer

A data layer written twice: as a module of exported functions (`src/orders/orders.repository.ts`)
and as a class (`src/orders/orders.class.ts`), with the same four queries in each. The
fixture exists to be compared rather than described — whatever the reader records for a
method it has to record for the function beside it.

Before R52 the leaf walk read the methods of the indexed classes and nothing else, so the
left-hand column of this table was empty: a query in a module-level function produced no
node, no unresolved row and no dynamic-table report. Nothing said it had been skipped,
which is the one failure this tool must not have. Two other fixtures were bent around the
limit — the Express fixture's repository was made a class to get a node at all — and a
real drizzle repository, whose data layer is a module of exported functions, read as a
project with no data access in it.

| Written as | Call site | `meta.op` | `meta.table` | document recorded |
|---|---|---|---|---|
| declared function | `orders.find()` | `read` | `Order` | — |
| arrow on a const | `orders.save(order)` | `write` | `Order` | `type:fn-data-layer#Order` |
| function inside a function | `orders.delete(id)` | `delete` | `Order` | — |
| arrow on a const | `invoices.save(invoice)` | `write` | `Invoice` | `type:fn-data-layer#InvoiceEntity` |

Eight `db_query` nodes from those two files, four from each, and each function gets a node
of its own exactly as each method does. A body is read whether or not anything calls it:
nothing in this fixture has an entry point, and a query that nobody reaches is still a
query.

`src/orders/orders.object.ts` holds the two remaining shapes. A module of functions
spelled as an object is a third way of writing the same thing, and the query in it is
recorded under `orderQueries.list`. A query written at the top level of a module is the
one shape with nowhere to go: it runs at import and belongs to no function anybody can
name, so it produces a `db-call-at-module-level` row instead of a node. Saying so is the
point — the reader used to be silent about a whole file of queries, and silence is the
one answer a tool like this must never give.

## The other half: a document is recorded whether or not the name was trimmed

`Order` and `InvoiceEntity` are the same fact spelled two ways. `meta.entityType` is the
declared name and is written only when a wrapper suffix was stripped off it, which is
right — there is nothing to report for `Order`. `meta.entityTypeId`, the document the
write stores, used to be written in the same place and so inherited that condition: a
project that does not suffix its entities recorded no document for any write, and
`stripImpact` answered `unknown` for every field a validation pipe strips off a body
(R48). Both writes carry it now.

## Deliberately unresolvable constructs

None. There is no `bootstrap-not-found` row here: this repository declares no NestJS
dependency, and `bootstrap` names a NestJS file, so asking for one would be asking
for a setting that does nothing (R51). Both repositories resolve to level 1 / `static`.
