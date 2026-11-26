# express-job-workers

A shop's Express server that runs its background work on BullMQ, with nothing
installed: its workers are made by a construction, `new Worker(name,
processor)`, rather than declared by a decorator (P271).

## Workers

| Where | Written as | Read as |
|---|---|---|
| `src/jobs/job-queue.ts` | `new Worker(type, processor)` in `buildWorker(type)`, called in `for (const type of Object.keys(handlers))`; the processor runs `handlers[type](job)` through a local function | one consumer per key: `send-receipt` → `sendReceipt`, `make-thumbnail` → `makeThumbnail`, `refresh-catalog` → `refreshCatalog`, each with `meta.through: ["JobQueue.buildWorker"]` |
| `src/jobs/side-workers.ts` | `new Worker('audit-queue', async (job) => …)` at the module's top | `audit-queue`, its handler the function written in place |
| `src/jobs/side-workers.ts` | `MAIL_QUEUES.map((name) => new Worker(name, sendReceipt))` over a list written out | `mail-low` and `mail-high`, one consumer `sendReceipt` on both |
| `src/jobs/side-workers.ts` | `for (const name of queuesFromSettings) new Worker(name, sendReceipt)` | no channel: `channel-dynamic`, its hint saying the list is not written out |
| `src/reports/reports.queue.ts` | the older library's `this.queue.process('build-report', 2, (job) => this.build(job))` | `reports-queue`, handler `ReportsQueue.build`, `meta.jobName: "build-report"` |

`failureHandlers[type]` in the same function is not the dispatch: only the
processor and the local functions it runs are searched for the record its
handler is looked up in.

## Enqueues

`createJob({ type, payload })` adds to `this.queues[options.type]`, a registry
filled with `new Queue(type)` (P267), and is drawn at each route that calls it:
`send-receipt` and `make-thumbnail` have both ends; `refresh-catalog` has a
worker and nothing that adds to it.
