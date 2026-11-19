# nest-queue-wrapper

A shop that runs its queues through a layer of its own over BullMQ, with
nothing installed but the framework: its own worker decorators, `Processor`
and `Process`, in `src/queue/processor.decorator.ts`.

## Workers

| Worker | Written as | Read as |
|---|---|---|
| `BuildExportJob` | `@Processor({ queueName: QueueName.exports, scope: Scope.REQUEST })` | `channel:exports-queue` |
| `SendMailJob` | `@Processor(QueueName.mail)` | `channel:mail-queue` |
| `CleanupCronJob` | `@Processor({ queueName: QueueName.cron })` | `channel:cron-queue` |
| `ReportCronJob` | `@Processor(QueueName.cron)` | `channel:cron-queue`, the same node |
| `AuditJob` | `@Processor({ queue: 'audit-queue' })`, a key nothing reads | no channel; `channel-dynamic` |

The options form is R181: read whole, `CleanupCronJob`'s queue was the channel
`{"queueName":"cron-queue"}`, beside the `cron-queue` its word form landed on,
and no producer can ever reach a node of that name. A queue is named by a word,
so a record where a queue is named is refused rather than drawn, which is what
`AuditJob` shows; a transport that matches records (`nest-kafka`'s
`{ cmd: 'sum' }`) keeps them.

## Enqueues (P267)

The broker is called in one place, `src/queue/bullmq.driver.ts`, on a client
kept per queue in a registry (`this.queues[queueName] = new Queue(queueName)`).
Every enqueue of the shop is a call of `JobQueueService` (`add`, `addCron`),
which hands its own queue - the one the container built it with - and its
caller's job to the driver through the `QueueDriver` interface. The container
builds one service per queue (`queue.module.ts`): `{ provide:
queueToken(name), useFactory: (driver) => new JobQueueService(driver, name) }`,
and a caller asks for one by name with the shop's own decorator,
`@InjectJobQueue(QueueName.mail)`, which is `Inject(queueToken(name))`.

Read where the broker is called, the queue and the job are parameters. They are
followed out to each caller, and each enqueue is drawn there:

| Caller | Queue | Job | How the queue was read |
|---|---|---|---|
| `ExportsController.start` | `exports-queue` | `BuildExportJob` | the decorator's token, to the provider that builds the instance with the same name |
| `WelcomeService.welcome` | `mail-queue` | `SendMailJob` | the same |
| `WelcomeService.resend` | `mail-queue` | none: `jobName` is its parameter and nothing calls it | the same |
| `WelcomeService.digest` | `mail-queue` | `SendMailJob` | `new JobQueueService(…, QueueName.mail)` where the field is initialised |
| `CleanupScheduler.onModuleInit` | `cron-queue` | `CleanupCronJob` | `addCron` into BullMQ's `upsertJobScheduler(id, repeat, { name, data })`: a repeated job is a job of the queue |
| `AuditService.record` | none | `audit` | `@Inject('AUDIT_QUEUE')` that nothing provides: `channel-dynamic`, its hint naming the instance |

Each producer carries `meta.through` (`BullMqDriver.add`, `JobQueueService.add`)
and is `heuristic`: bullmq is not installed, so the client is known from what
the registry is annotated to hold, and `this.driver.add` may run `SyncDriver`
instead. The driver draws nothing of its own, since every call of it is
attributed. `SendMailJob.name` reads as `SendMailJob` at both ends, so each
consumer's `meta.jobName` is the job its producers name.
