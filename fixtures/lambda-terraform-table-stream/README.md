# lambda-terraform-table-stream

A write to a table reaches the function its stream runs (P51). `shop` deploys
the table `shop-orders` with `stream_enabled`, a mapping from its stream to
`order-changed`, the Kinesis stream `shop-clicks` and a mapping from it to
`count-clicks`; `returns` writes to the shop's table from another repository.

Type-checked, never executed or deployed.

| Written by | As | Onto | Read there by |
|---|---|---|---|
| `place-order.ts` (`shop`) | `@aws-sdk/lib-dynamodb` `PutCommand`, `TableName: process.env.ORDERS_TABLE` set to `aws_dynamodb_table.orders.name` | `dynamodb/shop-orders` | `order-changed`, through the mapping, its `filter_criteria` on the edge |
| `cancel-order.ts` (`returns`) | `@aws-sdk/client-dynamodb` `UpdateItemCommand`, the name written out | the same | the same |
| `clear-orders.ts` (`returns`) | `BatchWriteItemCommand` keyed by `[process.env.ORDERS_TABLE]`, and version 2's `DocumentClient.delete` | the same | the same |
| `place-order.ts` (`shop`) | `BatchWriteCommand` keyed by the bare word `audit`, and by the shorthand `{ audit }` | `dynamodb/audit` | `order-changed`, through the audit mapping |
| `place-order.ts` (`shop`) | `TransactWriteCommand`: a `ConditionCheck` on the carts, a `Put` on the orders | `dynamodb/shop-orders` only | `order-changed` |
| workflow `shop-fulfil-order` (`shop`) | `dynamodb:updateItem`, `aws-sdk:dynamodb:transactWriteItems` (a check on the carts, a put on `audit`) | `dynamodb/shop-orders`, `dynamodb/audit` | `order-changed` |
| the same workflow | `aws-sdk:kinesis:putRecord`, `StreamName` | `kinesis/shop-clicks` | `count-clicks` |
| `track-click.ts` (`shop`) | `@aws-sdk/client-kinesis` `PutRecordCommand`, `StreamName` | `kinesis/shop-clicks` | `count-clicks` |

What is not joined, on purpose: `place-order.ts` also reads the carts table
with `GetCommand`, and a read never joins; and it updates `shop-carts`, a table
with no stream, which is no channel at all — no edge, no row. The workflow's
`deleteItem` on the carts is dropped the same way, and its `putItem` with
`TableName.$` is a `workflow-target-dynamic` row (P55); so are its
`batchWriteItem` with `RequestItems.$` and its JSONata `transactWriteItems`
whose `TransactItems` is an expression, one per state, naming the field (P62).

`flow workflow:shop-fulfil-order` walks each step's write through the streams
into `order-changed` and `count-clicks`.

`flow 'POST /orders/:param/cancel'` walks from the `returns` route through the
write, the shop's table stream and its mapping, into `order-changed` in `shop`.

`doctor` has two rows, both `info`: `stream-filter-not-matched` for the filter
on the orders mapping, and `workflow-target-dynamic` over three places, for
the tables the workflow chooses at run time.
