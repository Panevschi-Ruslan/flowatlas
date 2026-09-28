# nest-knex-raw

`knex.raw(sql)` takes its statement as text, and what it touches is written in
the SQL rather than anywhere the knex descriptor's locators look. Its text is
read with the reader the `pg` descriptor already uses (`sqlTables` and
`sqlOperation` in `packages/adapters-db/src/sql.ts`), and the call is recorded
in `tableReadings` as a method that takes a statement (`statements`).

The same call is two things. Awaited where it is written, it is a statement: a
visit to the database of its own. Handed to a builder of the same library, it is
a fragment of that builder's query, which is read on its own chain. Where the
call sits decides that. A value kept in a variable could become either, so its
text decides: a text no verb opens is a fragment wherever it is kept.

| Call site | Expected | Why |
|---|---|---|
| `raw('SELECT id, total FROM orders WHERE status = ?', [status])` | read `orders` | a literal statement |
| `await raw('DELETE FROM order_events WHERE created_at < ?')` | delete `order_events` | the verb gives the operation |
| ``raw(`… FROM orders o JOIN customers c … = '${region}' … = ${customerId} LIMIT ${limit}`)`` | read `orders`, `customers` | every substitution is a value |
| ``raw(`SELECT count(*) FROM ${ORDERS}`)`` | read `orders` | the substitution is a constant |
| `Promise.all([raw('… FROM orders'), raw('… FROM refunds')])` | read `orders`; read `refunds` | the language's `Promise.all` is not a builder |
| ``raw(`DELETE FROM ${table} …`)`` | a query with no table, `sql-parse-failed` | the table is a parameter |
| `raw('SELECT 1')` | nothing | a statement that names no table |
| `db('orders').where(raw(…)).whereIn(…, raw('SELECT id FROM customers …')).select('id', raw(…))` | one query, read `orders` | all three `raw` calls are fragments, the sub-select too |
| `const lowered = raw('lower(email) AS email')`, then `db('customers').select(lowered)` | one query, read `customers` | no verb opens the text |
| ``const now = raw(`"${column}"`)``, then `db('orders').update({ updated_at: now })` | one query, write `orders` | computed, but no verb opens it |
| ``const query = `WITH picked(id) AS (VALUES ${marks}) … IN (${marks}))` ``, then `raw(query, …)` | read `orders`, `refunds` | a `const` template is read where it was written; `picked` is the statement's own name |

A substitution counts as a value inside a quoted string, after a comparison,
after `LIKE`, `ILIKE`, `LIMIT` or `OFFSET`, the rows after `VALUES`, and as an
item of an `IN (…)` or `VALUES (…)` list. Anywhere else it may name a table or hide one, and the
statement is read no further than its verb.

Before R155 every `raw` here was counted and nothing else, and the graph held the
three builder queries only.
