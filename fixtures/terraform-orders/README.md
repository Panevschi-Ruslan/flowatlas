# terraform-orders

A small shop's orders service as Lambda functions, deployed with Terraform. It
is one of three fixtures that deploy the same handlers (`orders/src`) the same
way in three formats - this one, `serverless-orders` and `cdk-orders` - and
`scripts/deployments-agree.mjs` checks that the three read as one graph (P57):
the same ways in, the same channels, the same edges at the same confidence.

Type-checked, never executed or deployed.

| Way in | Declared as | Lands on |
|---|---|---|
| `POST /orders`, `GET` and `DELETE /orders/{id}` | a REST API, `dev-orders` | `place-order`, `get-order`, `cancel-order` |
| `GET /orders` | an HTTP API, `dev-orders` | `list-orders` |
| `ALL /*` | a function URL | `receipt` |
| `$connect`, `subscribe` | a WebSocket API, `dev-orders-websockets` | `live-socket` |
| `sqs/orders-dev-placed` | a mapping; failures redrive to `sqs/orders-dev-placed-dlq` | `ship-order` |
| `sns/orders-dev-shipped` | a subscription | `notify-customer` |
| `eventbridge/orders-dev/orders.service/OrderCancelled` | a rule on the custom bus | `refund-order` |
| `eventbridge/orders-dev/orders.service/OrderPlaced` | a rule on the custom bus | the workflow `orders-dev-shipping` |
| `cron(0 2 * * ? *)` | a scheduled rule, `orders-dev-nightly-report` | `nightly-report` |
| `dynamodb/orders-dev-orders` | the table's stream, through a mapping | `order-changed` |
| `s3/orders-dev-invoices` | a notification, `invoices/` ... `.pdf` | `index-invoice` |

The workflow's two steps invoke `reserve-stock` and `charge-payment`, named in
its definition by template variables. Code names every channel through a
variable the deployment sets: `ORDERS_TABLE`, `ORDERS_QUEUE_URL`,
`ORDERS_BUS_NAME`, `INVOICES_BUCKET`, `SHIPPED_TOPIC_ARN`.
