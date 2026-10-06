# aws-sdk-publishers

A lending library's API that publishes through the AWS SDK: plain Express
handlers that put events on EventBridge, send to SQS queues and, in two
functions kept beside it with their own manifests, publish to SNS and send with
version 2 of the SDK. It exists to prove the **publishing half** of a channel
whose subscriber is declared in Terraform. The subscribers are not read yet, so
every channel here has a publisher and no handler, and the link report says
exactly that: nine channels, all nine with no handler (`noConsumers`), none
joined. That is the honest answer until the deployment is read, not a defect
of the fixture.

The channel names follow one grammar, the one a subscriber read from the
deployment will arrive at:

| Service | Channel | Example here |
|---|---|---|
| EventBridge | `eventbridge/<bus>/<source>/<detail type>` | `eventbridge/library-events/library.loans/LoanCreated` |
| SQS | `sqs/<queue name>` | `sqs/library-returns` |
| SNS | `sns/<topic name>` | `sns/borrower-notifications` |

| Call | Read as | What the source states |
|---|---|---|
| `events.send(new PutEventsCommand({ Entries: [...] }))` in `publishLoanCreated` | `eventbridge/library-events/library.loans/LoanCreated`, carrying `Loan` | a command built in the call; `Detail: JSON.stringify(loan)` is read as the loan |
| `events.send(command)` in `publishHoldPlaced` | `eventbridge/default/library.holds/HoldPlaced` and `eventbridge/library-events/library.holds/HoldQueued`, each with its own message | a command built in a local and sent a statement later; two entries are two events; the first names no bus and goes to `default`, the second names the bus by its ARN |
| `bridge.putEvents({ Entries: [...] })` | `eventbridge/library-events/library.loans/LoanRenewed` | the aggregated client of version 3, input handed directly |
| `events.send(...)` in `auditLoan` | a publisher with no channel, and a `channel-from-environment` row naming `AUDIT_BUS_NAME` | `EventBusName: process.env.AUDIT_BUS_NAME`; the producer records the address it is waiting on in `meta.awaiting` |
| `sqs.send(new SendMessageCommand(...))` in `queueReturn` | `sqs/library-returns`, carrying `ReturnedItem` | the queue's URL, read to the name inside it |
| `sqs.send(new SendMessageBatchCommand(...))` | `sqs/library-returns`, and a `payload-type-unknown` row | the entries are built with `map`, so where the batch goes is written and what it carries is not |
| `sqs.send(...)` in `queueOverdue` | a publisher with no channel, and a row naming `OVERDUE_QUEUE_URL` | `QueueUrl: process.env.OVERDUE_QUEUE_URL` |
| `sqs.send(new ReceiveMessageCommand(...))`, `DeleteMessageCommand` | nothing | the same `send`, another operation: receiving is not publishing |
| `libraryEvents.put(new LibraryEvent({ type: 'ItemReturned', detail: item }))` | `eventbridge/library-events/library.returns/ItemReturned`, carrying `ReturnedItem` | the project's own helper, described in `flowatlas.config.json` with the `constructed-argument-path` locator and an address in parts |
| `publishEvent(new PutEventsCommand({ Entries: [...] }))` in `publishHoldCancelled` | `eventbridge/library-events/library.holds/HoldCancelled`, carrying `Hold` | a helper written as a function, described in `flowatlas.config.json` by `function` and the very locator the SDK's own description uses, `constructed-argument-path` on `PutEventsCommand` |
| `events.send(command)` inside `publishEvent` | a publisher with no channel, and a `channel-dynamic` row | `command` is a parameter annotated `PutEventsCommand`: a `PutEvents`, whose entries its caller wrote |
| `events.send(...)` inside `LibraryEventBus.put` | a publisher with no channel, and a `channel-dynamic` row | `DetailType: event.init.type` is whatever each caller hands the helper, which is why the helper is described |
| `sns.send(new PublishCommand(...))` in `functions/notify-borrower` | `sns/borrower-notifications` | the topic's ARN; the SNS client is declared only in that function's own `package.json`, which is what switches the reader on |
| the second `PublishCommand` there | a row naming `ESCALATIONS_TOPIC_ARN` | `TopicArn: process.env.ESCALATIONS_TOPIC_ARN` |
| `sqs.sendMessage({...}).promise()` in `functions/send-reminder` | `sqs/library-reminders`, carrying `Reminder` | version 2: `new AWS.SQS()` from `aws-sdk`, declared only in that function's manifest |

A name read from `process.env` is never turned into a channel: the variable's
name is not the queue's, and the value is set by the deployment. Resolving it
through the function's Terraform `environment` block is the second half of
this work, and until it lands each such call is a producer with no channel and
one row that names the variable.

The application is in `api/` rather than `src/` because the reader opens `src/`
alone when there is one, and the two functions beside it have to be read as
part of the same repository. The SNS client and version 2 of the SDK are
declared only in the functions' own manifests; their type stubs sit in the
repository's one `node_modules`, because that is the one the fixture suite
tracks, and resolution walks up to it from either function.
