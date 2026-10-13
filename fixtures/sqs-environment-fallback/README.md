# sqs-environment-fallback

A lending library's returns service whose code names a queue, a topic and a bus
by a variable of its environment with a default beside it:
`process.env.RETURNS_QUEUE_URL ?? '<url>'`, `?? ITEM_RETURNED_TOPIC` and
`process.env.EVENT_BUS_NAME || 'library-events'` (R175). The value the
deployment sets wins where it sets one; the default is where the code sends
from a function deployed without it.

Synthetic, in the shape of the aws-samples serverless projects. Type-checked,
never executed or deployed.

## Where the code sends

| Call | Function | Read as |
|---|---|---|
| `queueReturn`, `QueueUrl: process.env.RETURNS_QUEUE_URL ?? '…/library-returns'` | `library-record-return`, deployed with `RETURNS_QUEUE_URL = aws_sqs_queue.priority_returns.url` | `sqs/library-priority-returns`: the deployment's value |
| the same helper | `library-bulk-return`, deployed without the variable | `sqs/library-returns`, the default, read through the queue URL's form; the edge's `defaults` names the variable |
| `process-return`, `TopicArn: process.env.ITEM_RETURNED_TOPIC_ARN ?? ITEM_RETURNED_TOPIC` | `library-process-return`, deployed without it | `sns/library-item-returned`, the `const` the default names, read through the ARN's form |
| `process-return`, `EventBusName: BUS`, `const BUS = process.env.EVENT_BUS_NAME \|\| 'library-events'` | the same, deployed with `EVENT_BUS_NAME = aws_cloudwatch_event_bus.circulation.name` | `eventbridge/library-circulation/library.returns/ItemReturned`: the deployment's value, and not the default |

Each edge onto a channel says which functions it is for, which variables their
deployment set (`variables`), and which it left to the code's default
(`defaults`).

## Before

A part read from the environment waited on it, and the default beside it was
dropped. Where the deployment set the variable the channel was drawn; where it
did not, the call was an `environment-not-set` row and drew nothing, although
the code says exactly where it sends then: `library-bulk-return`'s returns and
every announcement of a return were missing.

A default that is not one name — an empty string, a pattern, or a second
variable (`process.env.A ?? process.env.B ?? 'x'`) — is not taken, and the row
stays.
