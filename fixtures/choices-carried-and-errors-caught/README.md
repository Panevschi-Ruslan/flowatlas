# choices-carried-and-errors-caught

A shop whose queue workers, caught errors and deployment choices are carried
further than they were (P304):

- `jobs`, Express and BullMQ with nothing installed: workers whose processor
  is written where the worker is made, and a notifier that queues a job
  named by the error it caught;
- `catalog`, a CDK app that hands `tryGetContext('stage')` to its stack as a
  bare argument, which keeps it in a field and reads it in another method;
- `payments`, Terraform: one API whose stage is looked up by the workspace in
  a map, one whose stage is the workspace;
- `web`, plain HTML and the classic scripts it loads (`browser`).

## Workers

| Written as | Read as |
|---|---|
| `new Worker('receipts', async (job) => { ...renderReceipt...; ...sendReceipt... })` in `ReceiptWorker`'s constructor | a consumer on `receipts` handled by `ReceiptWorker.constructor.Worker@10`, a function of its own that calls `renderReceipt` and `sendReceipt` |
| `return new Worker('refunds', async (job) => { ...refundOrder... })` in `startRefunds` | a consumer on `refunds` handled by `startRefunds.Worker@23`, which calls `refundOrder` |

## Caught errors

`Notifier.enqueue(name, data)` queues on `notifications`; the job is what
each caller hands it.

| Caller | Hands `enqueue` | Read as |
|---|---|---|
| `Notifier.notify` | `error.jobName`, caught around `this.check(kind)` (which throws `new Deferred('notify-later')`) and `axios.post(...)` | a producer in the catch naming `notify-later`, and a `channel-dynamic` row: the name may be read off an error of `axios`, which carries nothing read |
| `Notifier.pushed` | `error.response.data.retryJob`, caught around `axios.post(...)` only | a producer naming no job, and the same row |
| `Notifier.remind` | `kind`, a value of the scope around the try block | a producer at `POST /orders/:orderId/remind` naming `remind-payment` |

## Deployment choices

| Call | Read as |
|---|---|
| ``fetch(`${CATALOG_API}/products`)``, stage `beta` | `GET /products` of `catalog`, at any stage `-c` names, `beta` where none is - the context value handed on as an argument, defaulted by the parameter and kept in a field |
| ``fetch(`${PAYMENTS_API}/payments`)``, stage `live` | `POST /payments` of `payments`, at any stage the workspace picks: `sandbox` in the default workspace, `live` in `production` |
| ``fetch(`${RECEIPTS_API}/receipts`)``, stage `default` | `GET /receipts` of `payments`, at the workspace's stage, `default` where none is selected |

Each is joined `heuristic` (`via: served-at`) with a `base-url-from-files`
note that says what was taken as chosen at deploy time.
