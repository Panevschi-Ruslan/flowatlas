# data-kit-tables fixture

An Express service for a lending library whose every data access goes through
`@acme/data-kit`, a shared package the repository declares and nobody
installed. Nothing resolves the kit's types, so no data library is detected and
the Map would show no data boxes; the configuration names the kit's functions
once under `adapters.db.tables`, with the argument each names its table at
(P37).

Type-checked, never executed or deployed. The configuration at the root is the
project; the repository is the fixture itself.

```
./node_modules/.bin/tsc -p fixtures/data-kit-tables/tsconfig.json --noEmit
```

reports "Cannot find module" for `@acme/data-kit` and `express`, and nothing
else of note: that is the state being read.

## The queries

| Where | Call | Query | Read because |
|---|---|---|---|
| `lendBook` | `findOne(MEMBERS, …)` | read `members` | argument 0, a constant of the repository's own |
| `lendBook` | `insert(LOANS, loan)` | write `loans` | the same, the import matched by name |
| `lendBook`, `returnBook` | `auditLog(…)` | write `audit_events` | a function of the repository's own, its table named in the configuration |
| `returnBook` | `kit.remove('loans', …)` | delete `loans` | a namespace import of the kit |
| `archive` | ``insert(`loans_${year}`, loan)`` | write `?` | the table is worked out at run time: the query is kept, with a `dynamic-table-name` row |
| `joinLibrary` | `db.insert(MEMBERS, …)` | write `members` | `db` is what the kit's `createClient()` returned, the factory named on the row (P39) |
| `leaveLibrary` | `db.remove('members', …)` | delete `members` | the same client |
| `Reservations.hold` | `this.db.insert('reservations', …)` | write `reservations` | `db` is injected through the constructor, typed `DataClient` - the `clientType` named on the row (P44) |
| `releaseHold` | `db.remove('reservations', …)` | delete `reservations` | a parameter typed `ReturnType<typeof createClient>` (P44) |
| `notifyHold` | `mailer.insert('hold-notices', …)` | - | a parameter typed as something else |
| `queueWelcome` | `outbox.insert('welcome', …)` | - | an object of the repository's own, not a client the factory made |
| `lookalike` | `findOne('members')` | - | a local of the same name shadows the import, so it is not the kit's |

Every query is recorded with `source: "configured"` and `declared` confidence.
