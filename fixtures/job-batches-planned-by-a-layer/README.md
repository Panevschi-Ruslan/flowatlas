# job-batches-planned-by-a-layer

A shop's Express server whose BullMQ jobs go through a queue layer that plans
each batch before it sends it, with nothing installed (P298): the layer splits
a batch into the jobs for the queue, the scheduler and a relay, hands each
part on, and queues whatever the relay refuses from the list its error carries
back; a scheduler's template that names no job; and a worker whose processor,
written where the worker starts, does more than hand the job on.

## A batch planned by the layer

`QueueBase.addBulk(jobs)` hands the batch to `dispatch`, which takes
`{ toBull, toScheduler, toRelay }` out of what `planDispatch` answers - each
part one of the lists `separateByDelay` fills with `push` - queues `toBull`
through `addAllToBull` (`jobs[0]` where there is one job), and sends the rest
to the scheduler and the relay. A relay that refuses throws a
`PartialSendError` carrying the jobs it never sent, and `fallBack` queues
`error instanceof PartialSendError ? error.unsentJobs : jobs`.

| Route | Written as | Read as |
|---|---|---|
| `POST /signup` | `mail.add({ name: 'welcome', … })` | a producer on `mail` named `welcome` |
| `POST /orders/:orderId/invoices` | `invoices.addBulk([{ name: 'issue-invoice' }, { name: 'remind-invoice', delay }])` | one producer on `invoices` naming both jobs |

Every way out of the layer - the plan destructured, the parts spread back
together for the fallback, the list the error was thrown with, the batch handed
straight to the queue - is followed to the route, and nothing is drawn inside
the layer: a value that is one of several, some waiting on a caller, is each
of them followed on its own; what a `catch` is handed is each value its try
block throws, in the layer's own functions; a field of an error constructed
there is what its constructor keeps.

## A scheduler's job

| Written as | Job |
|---|---|
| `upsertJobScheduler('prune-baskets', …, { data })` | `prune-baskets`, the scheduler's id, as the library names it |
| `upsertJobScheduler('nightly', …, { name: 'rebuild-search', data })` | `rebuild-search` |
| `upsertJobScheduler('expire-coupons', …)` | `expire-coupons` |

## Workers

`WorkerBase.init(processor)` opens the worker with the topic the class
extending it hands `super(...)`.

| Class | Starts with | Read as |
|---|---|---|
| `MailWorker` | `this.init(async (job) => { …; await deliverMail(…); await recordDelivery(…) })` | a consumer on `mail` handled by `MailWorker.constructor.init@21`, a function of its own that calls `deliverMail` and `recordDelivery` |
| `InvoiceWorker` | `this.init((job) => this.issue(job))` | a consumer on `invoices` handled by `InvoiceWorker.issue` |

The `maintenance` worker is made with its processor in place at the module's
top, as before.
