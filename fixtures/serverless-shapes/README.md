# serverless-shapes

Two Serverless Framework services of a members' club in one repository, read
with `services[].infra.options: { "stage": "prod" }` (P57): `accounts` written
as `serverless.ts`, `notices` as `serverless.yml`. Every way of writing a value
the framework resolves, and what is not read, said as a row.

Type-checked, never executed or deployed.

| What | Read as |
|---|---|
| `accounts/serverless.ts` | the object `module.exports` is, its `functions` imported from `functions.ts` and built from a constant |
| `${opt:stage, 'dev'}` | `prod`, from the configured option |
| `${file(./config/${sls:stage}.yml):region, ...}` | `eu-central-1`, from `config/prod.yml`, the inner variable first |
| `${env:ARCHIVE_BUCKET, ...}` with `useDotenv` | `club-notices-archive`, from `.env` |
| `${param:digestRate}` | `rate(1 day)`, from `params.prod` |
| `NoticesQueue`, a queue with no `QueueName` | the channel `sqs/${…}@resources.Resources.NoticesQueue`, named by its declaration: `welcome` and `digest` send to it through `NOTICES_QUEUE_URL` and `send-notice` reads it, `static`; one `deployed-name-generated` note |
| `LapsedRule`, a rule in `resources` | `lapse` (in `accounts`) puts `MemberLapsed` on the default bus; the rule hands it to `digest` |
| `stepFunctions.stateMachines.remind` | a workflow with no name of its own, its step invoking `send-notice` by key, run by a schedule |
| `destinations.onFailure` | `send-notice`'s failures, onto `sqs/notices-prod-failed` |
| `cognitoUserPool` | `cognito/club-members/post_confirmation`, spelled as Terraform spells the trigger |

| Not read | Row |
|---|---|
| `audit`'s name, `${ssm:/club/audit-function-name}` | `function-name-unread`; the function is drawn under its declaration and its handler still read |
| `audit`'s queue, `!ImportValue shared-audit-queue-arn` | `subscription-source-unread` |
| `door`'s `alb` event | `invoker-not-read` (info) |
| `report` on `python3.12` | `function-runtime-unread` (info) |
| `renderer`, a container image | `function-image-unread` (info) |
| `constructs`, the lift plugin's | `deployment-plugin-unread` |
