# multi-repo-jobs

A shop that adds jobs to two queues through a layer of its own, and a mailer
that handles them (P271).

## Jobs

`shop`'s `MailQueueService` reads its queue where the broker is called
(`@InjectQueue('mail-queue')`), and takes the job's name as its own
parameter. Each enqueue is drawn at the controller method that names the job:

| Caller | Call | Job(s) |
|---|---|---|
| `OrdersController.welcome` | `send('send-welcome', …)` → `queue.add(job, data)` | `send-welcome` |
| `OrdersController.receipts` | `sendMany('send-receipt', list)` → `queue.addBulk(list.map((data) => ({ name: job, data })))` | `send-receipt`, read from the entry the map answers |
| `OrdersController.invoice` | `send('send-invoice', …)` | `send-invoice` |
| `MailQueueService.sendPair` | `addBulk([{ name: 'send-welcome' }, { name: 'send-digest' }])` | `jobNames: ["send-digest", "send-welcome"]` |
| `MailQueueService.resize` | `images.add('resize', …)` | `resize` |

## Handlers

`mailer`'s `MailProcessor` names the job each handler takes
(`@Process('send-welcome')`, `@Process('send-receipt')`), so the project has
two `job-no-handler` rows, both `info`: `send-invoice` at the invoice call and
`send-digest` at `sendPair`. `ImageProcessor` takes every job of
`image-queue`, so `resize` is not asked about.
