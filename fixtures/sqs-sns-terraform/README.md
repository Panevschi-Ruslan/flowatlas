# sqs-sns-terraform

A lending library's returns service: Lambda functions behind a REST API, joined
by SQS queues and an SNS topic. The code says where it sends, usually by a
variable whose value the Terraform sets; the Terraform says what reads each
queue and topic.

Type-checked, never executed or deployed.

## Where the code sends

| Call | Read as |
|---|---|
| `queueReturn` in `src/lib/returns-queue.ts`, `QueueUrl: process.env.RETURNS_QUEUE_URL` | run by `library-record-return`, deployed with `RETURNS_QUEUE_URL = aws_sqs_queue.returns.url`: `sqs/library-returns`, `static`. The `channel-from-environment` row the extractor wrote goes |
| the same helper, run by `library-bulk-return` | that function's deployment does not set the variable: one `environment-not-set` row naming the function and the variable |
| `process-return`, `TopicArn: process.env.ITEM_RETURNED_TOPIC_ARN` | `sns/library-item-returned`, from `aws_sns_topic.item_returned.arn` |
| `process-return`, `QueueUrl: process.env.AUDIT_QUEUE_URL` | set to `var.audit_queue_url`, which `infra/env/dev.tfvars` and `infra/env/prod.tfvars` set differently and nothing chooses: one `environment-value-unread` row naming both files, and no channel |
| `notify-borrower`, version 2: `new AWS.SQS().sendMessage({...}).promise()` | `sqs/library-reminders`, the queue's URL written in the code |
| `POST /holds`, a REST integration of type `AWS` with `sqs:path/<account>/<queue>` | the route itself publishes to `sqs/library-hold-requests`; the account is not known from the files and the queue is |

Every settings key a function sets says where its value comes from on the
`reads_config` edge that reads it (`setBy`).

## What reads them

| Channel | Read by |
|---|---|
| `sqs/library-returns` | an event-source mapping onto `library-process-return`; failures redrive to `sqs/library-returns-dlq` |
| `sns/library-item-returned` | a subscription to `sqs/library-restock` (a publisher of its own onto that queue), one to `library-notify-borrower` whose filter policy is recorded and not matched on, and one by e-mail, which is read and not followed (`subscription-target-unread` at `info`) |
| `sqs/library-restock` | through `terraform-aws-modules/sqs/aws` with `create_dlq`: a mapping onto `library-restock`, and the module's own redrive to `sqs/library-restock-dlq` |
| `sqs/library-reminders` | a mapping onto `library-send-reminder`, its filter criteria recorded |
| `sqs/library-hold-requests` | a mapping onto `library-place-hold` |

A redrive is a `triggers` edge from the queue to a publisher onto its
dead-letter queue, not a reader of the queue, so a queue nothing reads still
reads as one. Neither dead-letter queue has a reader, which is what
`dead --kind channels` says.
