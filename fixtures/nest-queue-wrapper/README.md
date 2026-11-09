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
