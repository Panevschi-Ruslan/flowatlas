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
| `track-click.ts` (`shop`) | `@aws-sdk/client-kinesis` `PutRecordCommand`, `StreamName` | `kinesis/shop-clicks` | `count-clicks` |

What is not joined, on purpose: `place-order.ts` also reads the carts table
with `GetCommand`, and a read never joins; and it updates `shop-carts`, a table
with no stream, which is no channel at all — no edge, no row.

`flow 'POST /orders/:param/cancel'` walks from the `returns` route through the
write, the shop's table stream and its mapping, into `order-changed` in `shop`.

`doctor` has one row: `stream-filter-not-matched` at `info`, for the filter on
the orders mapping.
