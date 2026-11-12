# job-flows-from-callers

A shop's Express server whose BullMQ jobs are decided by callers further out
than the layer that sends them, with nothing installed (P290): a worker's
processor handed in by each class extending the worker's base, flows built in
a loop over a rest parameter and from a list of children, and a queue reached
through a fallback inside the layer.

## Workers behind a base class

`BullClient.openWorker(topic, processor)` makes the worker; `WorkerBase.init`
hands it `this.topic`, kept from what the class extending it hands
`super(...)`, and the processor `init` is handed.

| Class | Hands its base | Starts with | Read as |
|---|---|---|---|
| `MailWorker` extends `MailWorkerBase` | `super(Topic.Mail, …)` in `MailWorkerBase` | `this.init(this.processor())`, a method answering the processor | a consumer on `mail` handled by `MailWorker.processor` |
| `ReceiptWorker` | `super(Topic.Receipts, …)` | `this.init(this.print.bind(this))` | a consumer on `receipts` handled by `ReceiptWorker.print` |
| `InvoiceWorker` | `super(Topic.Invoices, …)` | `new InvoiceWorker(…).init(issueInvoice)` from outside | a consumer on `invoices` handled by `issueInvoice` |

One consumer per queue, each with its own handler: the processor is followed
along the calls the topic was handed through, then out to the calls of
`init` made on instances of the class the topic is of.

## A queue reached through the layer's fallback

`QueueBase.add` sends to the queue directly or, when the relay is on, through
`dispatch` → `fallBack` → `addAllToBull` → `addToBull` → `BullClient.add`:
six calls from the broker's own `add` to the route. Every producer is drawn at
the route (`mail` named `welcome`, `invoices` named `issue-invoice`), none
inside the layer; `jobs[0]` of the list `dispatch([job])` is the job.

## Flows

| Route | Written as | Queues |
|---|---|---|
| `POST /images/:imageId` | `createSequentialJobFlow({ type: 'resize-image' }, buildPublishJob(…), undefined)` | `resize-image`, `publish-item` |
| `POST /items/:itemId/publish` | `createSequentialJobFlow(...jobs)`, `jobs` a list written with one job and given three more with `push`, one of them a spread list and one the request's | `archive-order`, `publish-item`, `notify-staff`, and a `channel-dynamic` row for the request's |
| `POST /months/:month/close` | `createJobWithChildren({ type: 'close-month' }, children)`, `children` given jobs with `push` in a loop and after it | `close-month`, `archive-order`, `retry-import` |

`createSequentialJobFlow(...jobs)` builds its tree in a `let` reassigned in a
loop over the rest parameter, each job the parent of the one before; the
`let` is each record it is given, the loop variable each element of the
list, and the list each argument the caller hands. `createJobWithChildren`
maps its children with `children.map((child) => this.buildFlowJob(child))`,
read per caller the same way.

Every queue has a worker: the six of `processors` and the three worker
classes.
