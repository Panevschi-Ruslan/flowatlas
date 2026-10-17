# lambda-traces

A small shop's checkout on AWS Lambda, deployed with Terraform, with one state
machine, and a trace of one checkout as an OpenTelemetry Lambda layer writes
it: what `flowatlas observe` lays over the map the Terraform and the state
machine draw (P107).

Synthetic. The account id (`111122223333`), the region and every ARN are made
up; the code is type-checked, never executed or deployed.

## What the map draws

| Thing | Drawn as |
|---|---|
| `checkout` behind `POST /checkout` (HTTP API) | `entry:shop:http:POST:/checkout` and `invoke:checkout`; its code writes the `orders` table, sends to `order-placed` and starts `fulfil-order` |
| the `orders` table, its stream on | `channel:dynamodb/orders`, read by a mapping onto `index-orders` (an `event` entry); `table:shop#orders` from the step that writes it |
| the `order-placed` queue | `channel:sqs/order-placed`, read by a mapping onto `ship-order` |
| `fulfil-order` | `workflow:fulfil-order`: `ReserveStock` (invokes `reserve-stock`), `ChargeCard` (`charge-card` by its ARN), `MarkPaid` (updates `orders`), `SendReceipt` (publishes to `receipts`) |
| `ship-order` | reads the order back and invokes `print-label` through the SDK |

## The trace

`traces/adot.otlp.json` is one checkout end to end, 21 spans in seven
resources, each with what a layer adds: `cloud.account.id`, `cloud.region`,
request ids, span names holding ARNs, a statement, a query string and a status
message, none of which may reach the observed file.

- `checkout` is named only by `cloud.resource_id`, an ARN with the alias `live`
  after it; its DynamoDB write names its table in `aws.dynamodb.table_names`
  (a list); its SQS send names the queue both bare and by URL.
- The workflow's run and its steps are spans of the state machine's resource,
  each step by `aws.step_functions.state.name`; `MarkPaid`'s write names the
  table by its ARN, and `SendReceipt`'s publish names the topic by its ARN.
- `ship-order` runs off the queue: the invocation, the message it processed
  (a consumer span with the bare queue name), a read of `orders` and an
  `Invoke` of `print-label`.
- `index-orders` runs off the table's stream with `faas.trigger: datasource`,
  which leaves no message span of its own.

Two spans are planted to match nothing: a read of `carts`, a table nothing in
the map names (`table`), and `SecretsManager/GetSecretValue`, a service nothing
here reads (`cloud`).

## Asked of it

`expected.cli/observe.txt` and `observe.json`: `observe` over the trace, the
clock fixed. Every span the trace was written to exercise lands on the node the
map draws for it - nine entries, twelve joins, four steps, the table and the
call sites - and the only unmatched rows are the two planted ones.
