# sam-shapes

The lending desk of a town library, deployed with AWS SAM (P246): a template
(`library/template.yaml`), a template it nests (`library/notices`) and a tool
rewritten by a macro (`library/tools`). Read with
`services[].infra.options: { "config_env": "prod" }`, so `samconfig.toml`'s
`[prod]` tables give the stack its name and `Stage` its value. Every way a
template settles a value, and what it does not, said as a row.

Type-checked, never executed or deployed.

| What | Read as |
|---|---|
| `Stage`, with no `Default` | `prod`, from `samconfig.toml`'s `[prod.deploy.parameters]` |
| `Globals` | `Runtime`, `CodeUri` and `Environment.Variables` under every function, `Api.Auth.ApiKeyRequired` on every REST route |
| `LendFunction`, `HoldsQueue`, `LoansTable`, `RenewalsStateMachine`: no name of their own | named by their declaration (`${…}@Resources.HoldsQueue`): `lend` sends to the queue through `HOLDS_QUEUE_URL` and `hold`'s `SQS` event reads it, `static`; the `overdue` workflow's step invokes `lend`; a rule starts `renewals`; one `deployed-name-generated` note each |
| `POST /loans`, no `RestApiId` | the API the transform makes, named after the stack, `library-prod`, behind an API key |
| `HttpApi` with no path | the default route, `ALL /{proxy+}` |
| `ReturnFunction`, built with esbuild | its handler in `src/returns/return-item.ts`, the entry point the bundle is named after |
| `Kinesis` with `DestinationConfig.OnFailure`, `EventInvokeConfig`, `AWS::Lambda::EventInvokeConfig` | the batches a mapping gives up on, and a function's results, handed on (P54) |
| `AuditFunction`, under `Audited` | `IsProd` is settled and `WithAudit` is not, so it is read as declared: its schedule is `heuristic`, `!FindInMap` gives it `rate(1 hour)`, `!If [IsProd, ...]` its name, and a `construct-conditional` note says why |
| `DevSeedFunction`, under `IsDev` | not deployed under these parameters, so not read |
| `IoTRule`, `Cognito`, a user pool's `LambdaConfig` | `iot/library/doors/+`, `cognito/library-members/post_confirmation` and `pre_sign_up`, as Terraform spells them |
| `CatalogApi`'s `DefinitionBody`, `BranchesApi`'s `AWS::Include` of `api/branches.yaml` | `GET /books/{isbn}` and `GET /branches/{branchId}`, from the integrations' URIs |
| `KioskFunction`, a plain `AWS::Lambda::Function`, its `AWS::Lambda::Url` and an `AWS::Scheduler::Schedule` | a function with its code in `src/`, `ALL /*` behind `AWS_IAM`, a nightly clock |
| `KIOSK_URL` and `BOOK_URL`, `!GetAtt ...Url.FunctionUrl` | `door`'s `fetch` calls joined to the two function URLs (P54) |
| `OverdueStateMachine` | a definition in place, a step naming `lend` with `!GetAtt` and one with a `DefinitionSubstitutions` placeholder |
| `Fn::ForEach::Shelves` over `[fiction, history]` | two queues, `fictionShelfQueue` read by `shelving` |
| `Notices`, a nested application in the repository | read under the parameters handed to it: its `SNS` event subscribes to `LostReturnsTopic` through `!Ref TopicArn`, and the parent's `NoticeRule` targets its output `SenderArn`; its REST API written as `AWS::ApiGateway` resources and methods gives `POST /notices/{noticeId}` |
| `tools/template.yaml` | a template of its own, its addresses under `tools/` |

| Not read | Row |
|---|---|
| `OwnerFunction`'s name, from `Owner`, which nothing gives a value | `function-name-unread`, naming the parameter |
| `Fn::ForEach::Branches` over `Branches`, which nothing gives a value | `construct-repeated-unread`; none of its queues is read |
| `Postcodes`, an application of the Serverless Application Repository | `nested-deployment-unread` |
| `SharedLayer` | `layer-not-followed` (info) |
| `ShelfMarks`, a macro of the library's own | `deployment-plugin-unread` |
| `DoorFunction`'s `CloudWatchLogs` event | `invoker-not-read` (info) |
| `DoorFunction`'s topic, `!ImportValue shared-notices-topic-arn` | `subscription-source-unread` |
| `ReportFunction` on `python3.12`, `CoversFunction` an image, `PingFunction` inline | `function-runtime-unread`, `function-image-unread` (info), `function-handler-unread` |
| `GET /branches`, an HTTP proxy | `route-target-unread`: no function runs it |
| `OverdueStateMachine`'s `Api` event | `route-target-unread`: a route onto a workflow is not drawn |
