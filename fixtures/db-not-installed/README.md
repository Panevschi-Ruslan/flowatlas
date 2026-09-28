# db-not-installed

A repository whose data libraries are declared and **not installed**, which is
what a stranger's clone is. There is no `node_modules` beside this fixture, so
`kysely` and `sequelize-typescript` resolve to nothing and the checker will not
say what any receiver is - the state all eight coverage targets were measured in
for R122, where 579 query sites on a photo server read as 0.

What the source still says is the point. An annotation names the type, an import
names the package, and a class of this repository states its table in a
decorator. None of that needs anything installed, and together they are the two
facts the descriptor was missing.

| Call site | Expected table | Op | What the source states |
|---|---|---|---|
| `this.db.selectFrom('asset')` | `asset` | read | `db: Kysely<DB>`, `Kysely` from `kysely` |
| `this.db.insertInto('asset')` | `asset` | write | the same annotation |
| `this.db.deleteFrom('asset_face')` | `asset_face` | delete | the same annotation |
| `eb.selectFrom('asset_face')` | `asset_face` | read | `eb: ExpressionBuilder<DB, 'asset'>`, a parameter of a free function |
| `Document.findAll()` | `documents` | read | `Document extends BaseModel extends Model`, `Model` from `sequelize-typescript`, table in `@Table` |
| `Document.create(…)` | `documents` | write | the same class |

Two shapes and one mechanism. A receiver is an annotated value - a constructor
parameter property, or a parameter of a function, which is how a photo server writes 28
of its query sites - or it is a class of this repository whose base comes out of
a package, which is how most repositories declare a model. The walk up the bases
is two hops here, and the first of them is a relative import, which resolves
with no `node_modules` at all.

Every edge here is `heuristic` and none is `static`, and that is deliberate: the
source states what the author meant rather than what a compiler checked. The
same repository with its dependencies installed reads the same tables through
the checker, at `static`, because the fallback is only ever asked where a
resolved type produced no descriptor.
