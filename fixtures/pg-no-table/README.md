# pg-no-table

A statement handed to `pg` that is complete and names no table (R162).

| Call site | Node | Row |
|---|---|---|
| `SELECT id, total FROM orders` | read `orders` | none |
| `SELECT 1` | none, counted | none |
| `BEGIN` | none, counted | none |
| `INSERT INTO orders …` | write `orders` | none |
| `COMMIT` | none, counted | none |
| `` `SELECT count(*) FROM ${table}` `` | a query with no table | `sql-parse-failed` |

Before R162 each of the three statements that name no table wrote
`sql-parse-failed`, whose hint says the query "is not a literal". They are
literals: the text was read in full, and it names nothing to look for.
`knex.raw` already counted such a statement without a row (R155). `pg` now makes
the same decision, in the same place. The row is kept for the one text that
cannot be read, because its table is decided at run time.
