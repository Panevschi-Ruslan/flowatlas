# multi-repo-failure-values

Five repositories of a shop that read the platform's clicks stream and hand
what they give up on to the platform's destinations, and name the platform's
queues with Jinja statements, sceptre's resolvers and Terraform's template
directives (P264). A mapping's failure destination is read wherever it is
written - a plain template, the CDK - even where the stream and the
destination are both parameters, a choice inside a choice the linker
settles; a sceptre stack is rendered with `{% set %}`, `{% if %}`, `{% for %}`
and filters, `stack_group_config` and `--merge-vars`, its `!stack_attr`,
`!join`, `!file` and `!no_value` read and its `!rcmd` said as not known;
Terraform's `%{ if }` and `%{ for }` around the platform's parameters are read
part by part, every way a condition nothing decides goes.

Type-checked, never executed or deployed.

| Service | Written with | Deployed with | Shares | Reads |
|---|---|---|---|---|
| `platform` | Terraform (`infra/main.tf`) | - | the clicks stream, the jobs and failed queues, the alerts topic; the stream's and the failed queue's ARNs, the prefix and the stage as parameters | - |
| `ledger` | plain CloudFormation (`infra/ledger.yaml`) | `rain deploy infra/ledger.yaml shop-ledger -y` in `package.json` | - | a mapping of the clicks parameter (a stream or a table's changes), its `DestinationConfig.OnFailure` the failed parameter (a queue or a topic) |
| `audit` | the CDK (`lib/audit-stack.ts`) | - | - | a `KinesisEventSource` of the stream looked up by the clicks parameter, `onFailure: new SqsDlq(...)` of the queue looked up by the failed parameter; an `EventSourceMapping` of the clicks parameter itself, `onFailure: new SnsDlq(...)` of the alerts topic |
| `orders` | a sceptre project: the Jinja template `templates/orders.yaml.j2` | `sceptre --merge-vars --var-file vars/base.yaml --var-file vars/prod.yaml launch -y prod` in `.github/workflows/deploy.yml` | - | the project's code and stage from the var files merged key by key; `Prefix` set in the `prod` group from `stack_group_config`; `JobsName` chosen by `{% if var.audit \| default(false) %}`, a `!join` of `!stack_attr parameters.Prefix` and `jobs`; `Owner` by `!file`; `Alerts` left to its default by `!no_value`; `Build` by `!rcmd`; `Colour` by a condition on the environment nothing gives; environment rendered from a `{% for %}` over `sceptre_user_data` |
| `stock` | Terraform (`infra/main.tf`, `infra/queue-url.tftpl`) | - | - | the jobs queue's address with `%{ if var.stage == "test" }` decided by the default; the alerts topic's ARN with a region chosen by `var.secondary`, which nothing sets; a spill queue whose name `var.secondary` chooses; the failed queue's address from a `templatefile` with `%{ for }` |

What the graph says:

- `ledger`'s mapping reads `kinesis/shop-prod-clicks` (kept of a stream and a
  table's changes), and what it gives up on goes to `sqs/shop-prod-failed`
  (kept of a queue and a topic, under the reading kept), which the platform's
  `shop-prod-replay` reads: no address of a reading is left.
- `audit`'s `shop-audit-index` hands what it gives up on to
  `sqs/shop-prod-failed`, the queue the parameter names, and
  `shop-audit-sample`'s mapping of the parameter itself (a stream or a table's
  changes) to `sns/shop-prod-alerts`, which the platform's `shop-prod-page`
  reads.
- `orders`' `shop-prod-ship` - named by a prefix built in the group's
  `{% set %}` - sends to `sqs/shop-prod-jobs` and publishes to
  `sns/shop-prod-alerts`, the template's default; it is deployed with
  `OWNER` `orders-team`, `REGION_NAME` and `TEAM` from the loop, and `BUILD`
  and `COLOUR` as values not known.
- `stock`'s `shop-stock-count` sends to `sqs/shop-prod-jobs` and
  `sqs/shop-prod-failed` and publishes to `sns/shop-prod-alerts`, each name
  built of the platform's parameters; the spill queue's name is not read,
  since which queue it is depends on `var.secondary`.

What it says it could not do:

| Row | Where | Why |
|---|---|---|
| `stream-no-writer` (finding) | `platform/infra/main.tf:24` | nothing configured writes to the clicks stream |
| `query-in-loop` (finding) | `stock/src/count.ts:9` | the count sends once per shelf |
| `environment-value-unread` | `stock/src/count.ts:12` | the spill queue's name depends on a condition the files do not decide |
