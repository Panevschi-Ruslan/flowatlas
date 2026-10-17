# loops-worth-fixing fixture

Exercises P89: one `query-in-loop` row per loop, loops bounded on purpose set
aside and counted, per-item loops as notes, and the rest ranked by how many ways
in reach them. A synthetic parcel-tracking service (NestJS, TypeORM, the MongoDB
driver, the SQS client and a mail transport).

| Loop | What the graph says |
|---|---|
| `ParcelsService.labelsFor`: `for-of`, two reads per id | one row, `severity: likely`, `reaches` both reads, `waysIn: 3` |
| `ParcelsService.statuses`: `ids.map` through `statusOne` | one row, `severity: likely`, `via: statusOne`, `waysIn: 1`, listed after `labelsFor` |
| `ParcelExport.exportAll`: `i += BATCH_SIZE` with `slice` | no row; `inLoop.bounded: chunk` |
| `ParcelExport.exportGroups`: one `SendMessageBatchCommand` per group | no row; `inLoop.bounded: batch-call` |
| `ParcelSync.syncAll`: `while (hasMore)` with `skip`/`take` | no row; `inLoop.bounded: page` |
| `ParcelSync.syncScans`: `do … while (token)` | no row; `inLoop.bounded: cursor` |
| `ParcelRetry.markDelivered`: `attempt < MAX_ATTEMPTS`, `break` in `try` | no row; `inLoop.bounded: retry` |
| `RegionSeed.seed`: `for (const region of ['north', 'south'])` | no row; `inLoop.bounded: literal` |
| `migrations/1700000000000-backfill.ts`: a `MigrationInterface` | no row; `inLoop.bounded: migration` |
| `ParcelDispatch.claimAll`: `findOneAndUpdate({ _id, status: 'queued' })` | one row, `severity: note` (kind note) |
| `ParcelDispatch.notifyAll`: `sendMail` per recipient | one row, `severity: note`: the configuration describes `sendMail` with `perItem: true` |

The repository node's `stats.loopsBounded` counts the seven loops set aside, one
of each kind. Type-checked, never executed; every package under `node_modules`
is a hand-written stub.
