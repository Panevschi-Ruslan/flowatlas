# cloudformation-shapes

The rides of a bike-share, deployed as plain CloudFormation (P248): a stack of
docks (`rides/stacks/docks.yaml`) that exports what it declares, a stack of
rides (`rides/stacks/rides.yaml`) that imports it and nests an alerts stack
(`rides/alerts/alerts.yaml`), a kiosk (`rides/kiosk/kiosk.yaml`) beside the
copy `aws cloudformation package` wrote of it, and an older template of the
fleet. No template is called `template.yaml`; each is found by what it says.
Every way a template is read, and what it is not, said as a row.

Type-checked, never executed or deployed.

| What | Read as |
|---|---|
| `City`, `Default: harbour` | `harbour`, in every name built from it |
| `RecountQueue`, no name of its own, exported by `docks` | named by its declaration (`${…}@stacks.docks.Resources.RecountQueue`): `start-ride` sends to it through `DOCKS_QUEUE_URL` and `DockMapping` reads it, both through `Fn::ImportValue`, `static`, with one `deployed-name-generated` note |
| `TallyMapping`, `Fn::ImportValue` of the table's `StreamArn` | `dynamodb/rides-harbour-docks`, onto `tally` |
| `RidesApi`'s `Body` | `POST /rides`, from the integration's URI, on the stage `v1` its `AWS::ApiGateway::Stage` deploys |
| `LookupApi`, a `Resource` and a `Method` | `GET /rides/{rideId}`, behind `COGNITO_USER_POOLS` and an API key |
| `StatusApi`, an HTTP API made in one resource with `Target` | the default route, `ALL /{proxy+}`, onto `status` |
| `MapsApi`'s `BodyS3Location: ../api/maps.yaml` | `GET /maps/{zone}`, from a file of the repository whose integration names `map` by its ARN |
| `BillingStateMachine`'s `DefinitionS3Location` | `workflows/billing.asl.json`, its step invoking `charge` through `DefinitionSubstitutions`, started every day by `BillingRule` |
| `Alerts`, an `AWS::CloudFormation::Stack` of the repository | read under the `City` handed to it: `alert`, every hour |
| `kiosk/kiosk.yaml` | `rides-kiosk` at its own address, behind `AWS_IAM` |
| `kiosk/kiosk.packaged.yaml` | not read: the same resources as `kiosk.yaml`, its code uploaded |

| Not read | Row |
|---|---|
| `LostSubscription`'s topic, `!ImportValue fleet-lost-topic`, which no template here exports | `subscription-source-unread` |
| `AuditMapping`'s queue, `rides-audit-queue`, exported by both `docks` and `kiosk` | `subscription-source-unread`: a stack imports one |
| `AuditLogsPermission`, for `logs.amazonaws.com` | `invoker-not-read` (info) |
| `ArchiveApi`'s body, in a bucket | `api-body-unread` |
| `ArchiveStateMachine`'s definition, in a bucket | `workflow-definition-not-loaded` |
| `legacy/fleet.template`'s `AWS::Serverless::Function`, with no `Transform` | `deployment-plugin-unread` |
