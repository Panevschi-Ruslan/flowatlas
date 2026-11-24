# deployment-settings-terraform

A shop's order workers: four Lambda functions each reading an SQS queue, and
two state machines, deployed with Terraform. The deployment and the code it
runs contradict each other in planted ways, each beside a twin that is right
(P389).

Type-checked, never executed or deployed.

## The queues and their readers

| Mapping | What is said |
|---|---|
| `ship_orders`: `shop-shipments` onto `shop-ship-order` (timeout 60) | `batch-failures-unreported`: the mapping says `ReportBatchItemFailures` and the handler, which catches every error, never returns `batchItemFailures`; `queue-visibility-short`: hidden 120s, under 6 x 60s; `queue-receives-few`: a redrive after 2 receives |
| `bill_orders`: `shop-billing` onto `shop-bill-order` (timeout 20) | `batch-failures-ignored`: the handler returns `batchItemFailures` and the mapping does not say it reports them; `queue-visibility-short`: hidden 10s, under the 20s timeout itself; `queue-redrive-missing` |
| `pack_orders`: `shop-packing` onto `shop-pack-order` (timeout 30) | nothing: Powertools' `processPartialResponse` builds the answer, the queue hides a message for 190s (6 x 30s + the 10s batch window), and a redrive policy of its own allows 5 receives |
| `send_notices`: `shop-notices` onto `shop-send-notice` (no timeout: 3s) | one `deployment-setting-unread` note: the visibility timeout is a variable nothing sets, and the handler returns what a package outside the repository returns. The redrive policy, JSON text, allows 10 receives |

## The state machines

| Step | What is said |
|---|---|
| `shop-fulfil-order`: `ReserveStock` | nothing: it retries the platform's transient errors |
| `ChargeCard`, a function by its ARN | `workflow-lambda-unretried` |
| `AwaitApproval`, `.waitForTaskToken` | `workflow-task-untimed` and `workflow-callback-no-heartbeat` |
| `ShipParcel`, `.sync` with `TimeoutSeconds` | nothing |
| `shop-accept-return`: `AwaitInspection` | nothing: the machine's own `TimeoutSeconds` bounds it, and it beats |
