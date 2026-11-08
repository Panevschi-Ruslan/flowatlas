# multi-repo-deploy-values

Five repositories of a shop that name each other's queues and topics with
values the others publish, written into one string two at a time, and deployed
by the tools that give a plain template its values from a pipeline (P261).
Every name is read part by part and written where each part is joined; a
mapping's failure destination that is itself a parameter is read as a choice
inside the mapping's own choice and kept with it; a sceptre stack inherits its
groups' parameters, renders its Jinja with what the pipeline launching it
gives, and reads another stack's output; rain is read from a GitLab job and a
shell script.

Type-checked, never executed or deployed.

| Service | Written with | Deployed with | Shares | Reads |
|---|---|---|---|---|
| `platform` | Terraform (`infra/main.tf`), state in `s3://shop-terraform-state/platform/terraform.tfstate` | - | the jobs, audit and tally-failures queues, the clicks stream, the alerts topic; the prefix, the stage and the account as parameters; the clicks stream and the tally-failures queue by parameters; the prefix and the stage as outputs of its state | - |
| `ledger` | Terraform (`infra/main.tf`) | - | - | the alerts topic's ARN built of the region and the account (aside) and the state's two outputs; the clicks stream by a parameter in a mapping whose failure destination is a parameter too; the jobs queue as a rule's target, its name built of the state's prefix and text |
| `orders` | a sceptre project: `templates/events.yaml` and the Jinja template `templates/orders.yaml.j2` | `sceptre --var stage=prod launch -y prod` in `.github/workflows/deploy.yml`, with `SHOP_PREFIX: shop` in the workflow's environment | the events topic, an output of the stack `shop-prod-events` | `Prefix` from the project's `config.yaml` (`{{ environment_variable.SHOP_PREFIX }}`), `Stage` from the `prod` group's (`{{ var.stage }}`), the handler from `sceptre_user_data`; the events topic by `!stack_output prod/events.yaml::TopicName`, billing's invoices queue by `!stack_output_external shop-billing::InvoicesQueueName` |
| `billing` | plain CloudFormation (`infra/billing.yaml`) | `rain deploy billing.yaml shop-billing --node-style original -y --params Stage=prod --params Prefix=shop` after `cd infra` in `.gitlab-ci.yml`, and the same in `scripts/deploy.sh` | the invoices queue's name, an output of the stack `shop-billing` | - |
| `audit` | the CDK (`lib/audit-stack.ts`) | - | - | the audit queue looked up by an ARN built in a template literal of two parameters; the jobs queue's address in `Fn.sub`, the alerts topic's ARN in `Fn.join` over a `+` of the same two |

What the graph says:

- `audit`'s `shop-audit-index` reads `sqs/shop-prod-audit`, the platform's, and
  sends to `sqs/shop-prod-jobs`, which the platform's `shop-prod-jobs` reads,
  and to `sns/shop-prod-alerts`: each name `${prefix}-${stage}-...` was read
  part by part, the prefix and the stage the parameters the platform writes.
- `ledger`'s `shop-ledger-tally` publishes to `sns/shop-prod-alerts`, its name
  built of the platform state's `prefix` and `stage`; its rule hands
  `EntrySettled` to `sqs/shop-prod-jobs`.
- `ledger`'s mapping reads `kinesis/shop-prod-clicks` (kept of a stream and a
  table's changes), and what it gives up on goes to
  `sqs/shop-prod-tally-failures` (kept of a queue and a topic, under the
  reading kept): no address of a reading is left.
- `orders`' `shop-prod-ship` - named by a prefix the pipeline's environment
  gives and a stage its `--var` gives, its handler rendered into the template
  from `sceptre_user_data` - publishes to `sns/shop-prod-order-events`, the
  topic its own events stack declares, and sends to `sqs/shop-prod-invoices`,
  which billing's `shop-prod-invoice` reads: billing's stack is `shop-billing`
  and its queue `shop-prod-invoices` because of rain's command, read once
  though the pipeline and the script both write it.

What it says it could not do:

| Row | Where | Why |
|---|---|---|
| `stream-no-writer` (finding) | `platform/infra/main.tf:44` | nothing configured writes to the clicks stream |
| `subscription-target-unread` (note) | `platform/infra/main.tf:66` | the alerts topic's e-mail subscription is outside the map |
