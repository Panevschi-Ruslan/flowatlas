# nest-sequelize-typescript

The decorated form of a sequelize model, which is how a TypeScript project
declares one. It is the same library as `fixtures/nest-sequelize` and nothing
about it is written the same way, which is why it has a fixture of its own.

Three facts make it unreadable without the records this fixture is here for.

The **receiver of a plain static call** is a class of this repository, and the
walk up its base chain reaches a class `sequelize-typescript` declares — so the
origin is `sequelize-typescript`, which is not the package the descriptor is
written for. `descriptorAliases` says the two names are one library.

The **table is in a decorator**: no `init` is ever written and no static
`tableName` is ever set, so `@Table({ tableName: 'documents' })` is the only
statement of it. `NAMING_DECORATORS` says where to read it.

**A scope retypes the receiver** to sequelize's own `ModelStatic`, which is what
made a scoped query recognisable as data access in the first place — and left its
table unreadable, because the receiver's text is then
`Document.scope("withOwner")` rather than a name. A scope narrows one model and
hands the same model back, so `NARROWING_CALLS` reads through it.

| Call site | Expected table | Op | Why it is readable |
|---|---|---|---|
| `Document.findByPk(id)` | `documents` | read | alias to the sequelize descriptor; `@Table` |
| `Document.scope('withOwner').findAll()` | `documents` | read | read through the scope |
| `Document.unscoped().scope(…).findOne()` | `documents` | read | read through two of them |
| `Document.create({ title })` | `documents` | write | — |
| `doc.update({ title })` | `documents` | write | the class the instance is typed as |
| `Document.destroy({ where })` | `documents` | delete | — |
| `Revision.findAll(…)` | `revision` | read | only a model name was stated |
| `doc.reload()` | — | — | not an operation, so not a second query |
| `connection.models[name].count()` | none, `dynamic-table-name` | read | chosen by name at run time |

`tableName` wins over `modelName` where both are stated, as it does for `init`,
because the table is what a reader looking at the database would see.

The model class is called `Document` on purpose: a wiki app's is, and a class that
shares its name with one of the language's own global interfaces is where a
reader that takes the first declaration a name has goes wrong.
