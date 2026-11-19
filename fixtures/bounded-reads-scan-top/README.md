# bounded-reads-scan-top

What a look up the directories still reads once every such look is bounded
(P334, P340): what the project keeps at the top of what it reads, and what a
service installs inside itself.

- `proto/ledger.proto` sits at the top of the project, two directories above
  both services, beside the configuration. `ledger` (plain JavaScript) loads
  it by its bare name, `loadSync('ledger.proto')`, and registers
  `books.LedgerService` with `{ record, balance }`; `till` (Express) loads it
  the same way and calls both methods from its routes. The search for a
  contract climbs from a service to the nearest `.git` or configuration and
  never above the directories the build was asked to read where there is no
  checkout, so the contract here is found and both methods are joined.
- `till` imports `toMinor` and `Money` from `@books/money`, installed in
  `services/till/node_modules`. The compiler resolves it as before: only an
  install whose directory lies above the top of the checkout (or, outside
  any checkout, above what the build reads) is hidden from it.

What this fixture cannot show is the decoy above: a fixture lives inside
this repository's own checkout, and a nested `.git` cannot be committed, so
an install, schema or contract above a service's checkout is exercised by
the unit tests instead (`core/src/upward-walk.test.ts`,
`adapters-entry/src/grpc.test.ts`,
`adapters-db/src/leaves/prisma-schema.test.ts`), which make the checkout in
a temporary directory.
