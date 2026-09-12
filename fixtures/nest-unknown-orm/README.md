# nest-unknown-orm

The two ways a data layer can be recognised when no descriptor exists.

| Call site | Expected |
|---|---|
| `this.orderRepo.find()` / `.persist()` | table `Order` from the type argument, op `null`, heuristic, one `unknown-db-package` row each |
| `this.localRepo.find()` | no table, heuristic, one `db-receiver-name-only` row |

An unfamiliar data layer still reaches the graph. What is lost is only the
distinction between reading and writing, and the tool says so rather than
guessing.
