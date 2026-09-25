# nest-knex

A knex query starts from the table and then chains, so the call that carries
the operation is the last one and the table is in the call the chain started
from. The `knex` descriptor's locator walks back down the receivers to find it.

| Call site | Expected table | Op |
|---|---|---|
| `db('users').select('id', 'email')` | `users` | read |
| `db('users').where({ id }).orderBy('email').first()` | `users` | read |
| `db(USERS).count('id')` | `users` | read |
| `db.select('id').from('users').whereRaw(…).first()` | `users` | read |
| `db('users').insert({ email }).returning('id')` | `users` | write |
| `db('user_events').insert(…).returning('id')` | `user_events` | write |
| `db('users').where({ id }).update({ email })` | `users` | write |
| `db('users').where({ id }).del()` | `users` | delete |
| `db.count('*').first()` | none, `dynamic-table-name` | read |
| `db(table)` where `table` is a parameter | none, `dynamic-table-name` | delete |

`USERS` is a constant rather than a literal, and is followed like one: the two
are the same fact written twice.

The fourth row and the ninth are what a real repository taught. Running this
against directus showed that most knex queries are not written starting from
the table at all: they start from the columns and name the table in a `from`
halfway along. Reading the call the chain started from put `id`, `*`, `u.id`
and `project_logo` into the graph as tables — names that look like answers and
are not. The `from` is asked for first now, and the call the chain started from
is the fallback; a chain whose root is itself an operation, as in `count('*')`,
has no root worth reading and says so.

The walk steps from a call to a call, not from a call to a property. The
builder here is reached through `this.db(…)`, and a walk that treated `this.db`
as another link of the chain walked past the root and lost the table on every
row — which is exactly what the first run of this fixture showed.

`where`, `orderBy` and `returning` are not operations of the descriptor. They
narrow a query some later call will run, and listing them would emit a row per
link of the chain for a single visit to the database.
