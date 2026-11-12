# job-queue-layers

A shop's Express server whose BullMQ queues sit behind layers of its own, with
nothing installed (P286): a base class keeps each queue's topic from what the
class extending it hands `super(...)`, a client opens the queue in one method
and adds to it in another, job records are built by functions further in, and
a flow adds a tree of jobs on several queues at once.

## Queues behind a base class

| Where | Written as | Read as |
|---|---|---|
| `src/queues/bull.service.ts` | `openQueue(topic)` sets `this.queueClient = new QueueClass(topic)`, the class chosen by `!premium ? Queue : require(…).QueuePremium`; `add(name, data)` calls `this.queueClient.add(name, data)` | the queue is what the instance was opened with, read where the caller holds the instance |
| `src/queues/queue-base.ts` | `QueueBase` keeps `topic` from its constructor and opens its client with it; `MailQueue` hands `super(Topic.Mail, …)`, `InvoiceQueue` hands `super(Topic.Invoices, …)` | `mail.add({ name: 'welcome' })` is a producer on `mail` named `welcome`, `invoices.add({ name: 'issue-invoice' })` one on `invoices`, both `through: BullService.add > QueueBase.addToBull > QueueBase.add` |
| `src/queues/queue-base.ts` | `WorkerBase.start(processor)` opens a worker on `this.topic`; `MailWorker` and `InvoiceWorker` hand their topic to `super(...)` | one consumer at `BullService.openWorker` on `mail` and `invoices`, `through` naming each class; the processor each is started with is followed out to `startWorkers` (P290), whose arrows do more than delegate, so the handler is `startWorkers` and `consumer-handler-unresolved` says so |

## Job records built further in

`createJob(options)` adds to `this.queues[options.type]` (P267), a registry
typed `{ [type in JobType]?: Queue }`:

| Route | The record handed in | Queues |
|---|---|---|
| `POST /orders/:orderId/archive`, `…/restore` | `await buildArchiveJob({ …, type })`, an `async` function answering `{ type, payload }` with `type` taken out of its options | `archive-order`; `restore-order` |
| `POST /images` | `await buildThumbnailJobIfNeeded(…)`, answering a record, another function's record, or nothing | `make-thumbnail` and `notify-staff` |
| `POST /staff/notify` | `{ ...buildNotifyJob(…), delay }` | `notify-staff` |
| `POST /partners/:partnerId/ping` | `{ type: urgent ? 'ping-partner-parallel' : 'ping-partner' }` | both |

`this.queues['nightly-report'].upsertJobScheduler(…)` is a producer on
`nightly-report`: the registry's entry type is read through the mapped type.

## Flows

| Where | Written as | Read as |
|---|---|---|
| `JobQueue.closeMonth` | `this.flows.add({ queueName: 'close-month', children: [{ queueName: 'archive-order' }] })` | one producer on both queues, `jobNames: ["archive", "close"]` |
| `POST /reports/nightly` | `addAfterChildren(parent, children)`, the flow `{ ...this.flowJob(parent), children: children.map(…) }` | drawn at the route on `nightly-report` and, each child read at the route (P290), on `archive-order` |

Every queue has a worker: the eight of `processors` (P271) and the two of the
worker classes.
