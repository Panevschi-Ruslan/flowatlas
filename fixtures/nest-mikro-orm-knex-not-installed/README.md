# nest-mikro-orm-knex-not-installed

`nest-mikro-orm-knex` with nothing installed: the same `src`, and no
`node_modules`. `@mikro-orm/postgresql` resolves to nothing, so the checker cannot
say what the manager is, what `getKnex()` returns, or what any query in the file is
made on. That is the state of a fresh clone, and of a workspace whose own packages
re-export the ORM from a build that was never run.

What the source still states is enough. The manager's type is written in three
places a reader can see, and each names the module it comes from:

- a type argument: `this.getActiveManager<SqlEntityManager>()`, which is how a
  repository base hands a method the manager for the transaction it is in, and the
  only place such a repository writes the manager's type down;
- an annotation: `constructor(private readonly em: SqlEntityManager)`;
- a cast: `context.manager as SqlEntityManager`, in a function outside any class
  that is handed a context rather than a manager.

`SqlEntityManager` is imported from `@mikro-orm/postgresql`, which `handovers`
records as declaring something whose `getKnex()` yields knex. From there the
reader walks from each query's receiver down to that call - through the links of
the chain, through the builder being invoked, through an unannotated variable,
and through either side of `??` - and reads the query with the knex descriptor
as though the checker had got there itself.

| Call site | Expected table | Op | What the source states |
|---|---|---|---|
| `super.getActiveManager<SqlEntityManager>().getKnex()({ il: 'inventory_level' }).select(…)` | `inventory_level` | read | the type argument |
| `knex('inventory_level').select(…)` | `inventory_level` | read | the type argument, one variable away |
| `knex.select('location_id').from('reservation_item')…first()` | `reservation_item` | read | the type argument, two variables and a `??` away |
| `this.em.getKnex()('inventory_level').where(…).update(…)` | `inventory_level` | write | the annotation |
| `knex.select('location_id').from('reservation_item')` | `reservation_item` | read | the cast, `context.manager as SqlEntityManager` |

One more query is deliberately **not** read. In `optionValues`, the manager is
`context.manager as any`: the source erases its type, so `getKnex()` may be the
ORM's and may be any other method of that name. The walk reaches the described
method and cannot confirm what it was called on, so there is no query. There is
one `db-handover-unstated` row, at the chain's first link (line 74), saying
which type to state (R163). A holder that states some *other* type is a
different library's method and gets no row at all.

The type argument and the cast are read here and nowhere else. Each takes the
written type *and* a described method called on what it names to produce
anything, so no other receiver reads differently because of them.

Every edge is `heuristic` and none is `static`: the source states what the author
meant rather than what a compiler checked. The installed fixture reads the same
tables at `static`, because the checker is always asked first.
