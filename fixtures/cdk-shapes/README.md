# cdk-shapes

A members' club deployed with an AWS CDK app (P57): the shapes a CDK app is
written in, read by following the app from its entry, and what is not read,
said as a row.

Type-checked, never executed or deployed.

| What | Read as |
|---|---|
| `Inbox`, a queue with no name, and `Sender` and `Reader`, functions with none | named by their place in the app: `sqs/${…}@ClubStack.Inbox`, `invoke:${…}@ClubStack.Sender`; `Sender` sends to the queue through `INBOX_URL` and `Reader` reads it, `static`; `deployed-name-generated` notes |
| `Code.fromAsset(path.join(__dirname, '..', 'dist', 'mail'))` | the handlers under `src/mail`, mapped back by `tsconfig.json` |
| `Mailbox`, a construct of the app's own made twice | two topics and two functions, each under its own name; each function's code is `lib/mailbox.Handler.ts`, the `NodejsFunction` default beside the file that makes it |
| `worker(this, kind, ...)`, a helper in another file, over `['welcome', 'renewal']` | a queue and a worker per kind, at the helper's lines |
| `Renewals`, a chain with a `Choice` | a workflow with no name of its own: `Charge` invokes `Sender`, `Remind` sends to the inbox |
| `Lapses`, `DefinitionBody.fromFile` with `definitionSubstitutions` | `statemachine/lapses.asl.json`, its `${ReaderArn}` filled with `Reader` |
| `if (props.stage === 'prod')` | settled by the context's `dev`: the nightly rule is not deployed and not drawn |
| `lambda.Function.fromFunctionName(this, 'Billing', 'club-billing-charge')` | a rule's target by name, joined wherever a configured service deploys it; here none does (`reference-not-found`) |
| `UserPool` `lambdaTriggers.postConfirmation` | `cognito/club-members/post_confirmation` |

| Not read | Row |
|---|---|
| a queue per name of `ssm.StringParameter.valueFromLookup(...)` | `construct-repeated-unread`: one read in their place |
| `if (process.env.WITH_AUDIT === 'yes')` | `construct-conditional` (note); the rule is drawn, `heuristic` |
| `ArchiveStack`, never made by the app | `construct-unreached` (note) |
| `cdk.Aws.ACCOUNT_ID`, `cdk.Fn.importValue(...)` in `Reader`'s environment | unread values, which only matter where code reads them |
