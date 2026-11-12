# multi-repo-shared-values

Five repositories of a shop that share queues, a topic, a function, a stream
and plain text through exports and parameters of the account, deployed with
five different tools (P259). Each plain template is read with the values the
tool that deploys it gives it: a sceptre stack configuration, a YAML parameter
file beside it, a `rain deploy` command. A rule's targets and a subscription's
endpoint are values another repository exports, and two addresses are built of
two exports each.

Type-checked, never executed or deployed.

| Service | Written with | Deployed with | Shares | Reads |
|---|---|---|---|---|
| `platform` | plain CloudFormation (`templates/platform.yaml`) | sceptre: `config/prod/platform.yaml` (the `prod` group, chosen by `infra.options.config_env`) and `config/dev/platform.yaml`; `project_code: shop` makes the stack `shop-prod-platform` | the prefix and the account as text, the jobs queue under `${AWS::StackName}-jobs-queue-arn`, the fulfil function, the alerts topic's name; the clicks stream, the jobs queue, the fulfil function and the account in parameters | - |
| `orders` | plain CloudFormation (`stacks/orders.yaml`) | `stacks/orders.parameters.yaml`, a YAML list of `ParameterKey` / `ParameterValue` | - | a rule whose targets are the platform's function and jobs queue; the jobs queue subscribed to its own topic; the audit queue's address built of the account and the prefix (`${Prefix}-orders-audit`); the alerts topic's ARN joined of the account and the topic's name |
| `ledger` | Terraform (`infra/main.tf`) | - | - | the clicks stream by a parameter, in a mapping with a failure destination; the jobs queue by a parameter as a rule's target; the fulfil function by a parameter as a subscription's endpoint |
| `billing` | plain CloudFormation (`billing.yaml`) | `rain deploy billing.yaml shop-billing --params Stage=prod --config billing-config.yaml` in its `package.json` | the invoices queue's name, an output of the stack `shop-billing` | - |
| `reports` | the Serverless Framework (`serverless.yml`) | - | - | the invoices queue's address built of the account parameter and `${cf:shop-billing.InvoicesQueueName}` |

What the graph says:

- `orders`' rule hands `OrderShipped` events to the platform's `shop-prod-fulfil`
  function and to `sqs/shop-prod-jobs`: each target was read as a function, a
  queue, a topic, a bus and a workflow, and the one the platform's export is
  was kept.
- `sqs/shop-prod-jobs` is one channel `orders`' subscription, `orders`' rule
  and `ledger`'s rule hand to, and the platform's `jobs` function reads.
- `orders`' `ship` sends to `sqs/shop-orders-audit`, the name built of the
  platform's prefix and `-orders-audit`, which the platform's `audit` function
  reads; and publishes to `sns/shop-prod-alerts`, the account in its ARN aside.
- `ledger`'s mapping reads `kinesis/shop-prod-clicks` (kept of a stream and a
  table's changes), and what it gives up on goes to
  `sqs/shop-ledger-tally-failures`, drawn once per reading and kept with it.
- `ledger`'s topic runs the platform's `shop-prod-fulfil` function: the
  protocol says the endpoint is a function.
- `reports`' `close` sends to `sqs/shop-prod-invoices`, which billing's
  `invoice` function reads: the stack is `shop-billing` because rain's command
  names it, and the queue `shop-prod-invoices` because of its `--params` and
  `--config`.

What it says it could not do:

| Row | Where | Why |
|---|---|---|
| `stream-no-writer` (finding) | `platform/templates/platform.yaml:85` | nothing configured writes to the clicks stream |
| `subscription-target-unread` (note) | `platform/templates/platform.yaml:77` | the alerts topic's e-mail subscription is outside the map |
