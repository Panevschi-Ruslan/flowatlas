# multi-repo-parameters

A small shop of four repositories, each deployed with a different tool, that
share an API, queues, a table's stream and a topic by writing them to
parameters of the account and reading them back by name (P253). Nothing is
deployed; the linker joins each parameter read to the one written under the
same name, as it joins an output to its import (P249).

Type-checked, never executed or deployed.

| Service | Written with | Writes | Reads |
|---|---|---|---|
| `platform` | Terraform (`infra/main.tf`) | the REST API `shop`'s id (`/shop/api/id`), the queue `shop-orders-placed`'s address and ARN (`/shop/orders/placed-url`, `/shop/orders/placed-arn`) | the catalog's topic, by `data "aws_ssm_parameter"`, for its `notify` subscription |
| `orders` | the Serverless Framework (`serverless.yml`) | its table's stream (`/shop/orders/stream-arn`) and its audit queue's name (`/shop/audit/queue-name`), as `AWS::SSM::Parameter` | the REST API by `${ssm:/shop/api/id}` - `POST /orders` hangs from it; the placed queue's address by `${ssm:...}` |
| `catalog` | plain CloudFormation (`stacks/catalog.yaml`, its `Stage` from `stacks/catalog.parameters.json`) | its topic, which has no name of its own (`/shop/catalog/restock-topic-arn`) | the orders table's stream by `{{resolve:ssm:...}}` in a mapping that reads a stream or a table's changes; the placed queue by a parameter typed `AWS::SSM::Parameter::Value<String>` as a failure destination that may be a queue, a topic, a bus or a function; the audit queue's address built around its name with `!Sub`; `/shop/flags`, which nobody writes |
| `reports` | the AWS CDK (`lib/stacks.ts`, two stacks) | its jobs queue (`Stack.exportValue`, `reports-jobs-arn`) and its bus's name (`StringParameter`, `/shop/reports/bus-name`) | the storage stack's queue, handed to the worker stack as a construct and by `Fn.importValue`; the bus name by `valueForStringParameter`; the placed queue and the orders table's stream by `valueForStringParameter` |

What the graph says:

- `POST /orders` is `orders`' route on the platform's API, at `/orders`.
- `sqs/shop-orders-placed` is one channel: `orders` sends to it through the
  address it reads, `reports`' `tally` reads it, and `catalog`'s failed
  restocks are handed to it - the destination was read as each of the four
  things it may be, and only the queue is kept.
- `dynamodb/shop-orders` is one channel both `catalog`'s and `reports`'
  mappings read: each was read as a stream and as a table's changes, and the
  orders service's value says it is the table's.
- `catalog`'s `restock` sends to `sqs/shop-orders-audit` through an address
  built around the queue name `orders` writes.
- The catalog's topic has no name; the platform's subscription reads
  `sns/${…}@catalog@stacks.catalog.Resources.RestockTopic`, the catalog's own
  channel, by the catalog's name.
- `reports`' two stacks are one app: the worker reads the storage stack's
  queue and bus by the values the app itself publishes, with no import left.

What it says it could not do:

| Row | Where | Why |
|---|---|---|
| `export-not-found` | `catalog/stacks/catalog.yaml:69` | `{{resolve:ssm:/shop/flags}}`: no configured service writes the parameter |
| `deployed-name-generated` (note) | `catalog/stacks/catalog.yaml:27` | the topic has no name of its own |
