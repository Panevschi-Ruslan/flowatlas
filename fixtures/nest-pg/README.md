# nest-pg

The types say nothing here, so the table names are read out of the query string
and the operation comes from its verb.

| Call site | Expected tables | Op |
|---|---|---|
| `SELECT … FROM orders` | `orders` | read |
| `SELECT … FROM orders o JOIN customers c` | `orders`, `customers` | read |
| `INSERT INTO orders …` | `orders` | write |
| `UPDATE orders SET …` | `orders` | write |
| `DELETE FROM orders …` | `orders` | delete |
| `SELECT * FROM public."invoices"` | `invoices` | read |
| `WITH recent AS (SELECT … FROM orders) SELECT … FROM recent` | `orders` only | read |
| interpolated query | none, `sql-parse-failed` | none |

`recent` must not appear as a table: it exists only for the duration of that
query.
