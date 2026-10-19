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

## The exports

`exports/` holds the same checkout as four files a Lambda team can make with
the AWS CLI or the console, without a collector (P108), each written from the
AWS documentation's examples with made-up ids, ARNs and times, and every field
a reader must not read planted in it:

| File | What it is | What it gives |
|---|---|---|
| `xray.batch-get-traces.json` | `aws xray batch-get-traces`: the stage, each function's `AWS::Lambda` and `AWS::Lambda::Function` segments, the state machine with its steps, an inferred DynamoDB segment | everything the OTLP trace gives: nine entries, twelve joins, the steps, the table, the channels, the two planted unmatched calls |
| `fulfil-order.history.json` | `aws stepfunctions get-execution-history`, with `describe-execution` merged in | the workflow's run, its four steps, `ChargeCard`'s direct invoke of `charge-card`, and the three service integrations whose target the history does not name, each credited to the one target of its kind the step's task reaches on the map (P110): `ReserveStock`'s invoke, `MarkPaid`'s table and its stream, `SendReceipt`'s topic |
| `checkout.access-log.jsonl` | the HTTP API's JSON access log: the checkout, and a `$default` request for `/favicon.ico` | `POST /checkout`'s hit, status and latency, and the favicon as unmatched |
| `report-lines.insights.json`, `.csv` | a Logs Insights export of the functions' log groups: six `REPORT` lines, a `START` line and a log line | each function's run, `charge-card`'s as an error |

Planted, and never read: annotations, metadata, a `sql` block, a `cause`, a
user, request ids, the account and the region, a client address, a user
agent, the API's id, a query string, a workflow's input, output and
parameters, a role ARN, memory figures, an init duration and the X-Ray ids on
a `REPORT` line.

## Asked of it

`expected.cli/observe.txt` and `observe.json`: `observe` over the trace, the
clock fixed. Every span the trace was written to exercise lands on the node the
map draws for it - nine entries, twelve joins, four steps, the table and the
call sites - and the only unmatched rows are the two planted ones.

`expected.cli/observe.xray.txt`, `observe.sfn-history.txt`,
`observe.apigw-access-log.txt`, `observe.lambda-report.txt` and
`observe.lambda-report.csv.txt`: `observe` over each export alone;
`observe.exports.json`: the file the four make together.
