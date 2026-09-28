# pg-query-verb

A query string that parses, names a table, and opens with no verb the reader
knows. It is the one place `unknown-db-operation` is written
(`packages/core/src/adapters/db.ts`), and before this fixture no test and no
snapshot held it: a regression in the row passed every gate.

| Call site | Table | Op | Row |
|---|---|---|---|
| `SELECT … FROM orders` | `orders` | read | none |
| `/* nightly report */ SELECT count(*) FROM orders` | `orders` | none | `unknown-db-operation` |
| `EXPLAIN SELECT * FROM invoices` | `invoices` | none | `unknown-db-operation` |

The first is the control. The second is an ordinary query a reader cannot
place only because it starts with a comment; the third is a verb the reader
has no entry for. Both still reach the graph as a visit to the table, with the
operation left open rather than guessed.

The snapshot holds the row's hint as the tool writes it. It once asked for
`query` to be added to the operations of the `pg` descriptor, which did not fit
this path: the descriptor already lists `query`, and a query read out of its text
takes its operation from the verb, never from that list. The hint now names the
case itself - a text that does not open with a verb the reader knows - and says
the descriptor needs no change (R139).
