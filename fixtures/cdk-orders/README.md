# cdk-orders

The deployment of `terraform-orders`, written as an AWS CDK app in TypeScript
over the same handlers, and read as the same graph (P57;
`scripts/deployments-agree.mjs`). The app is read statically from the entry
`cdk.json` names; nothing is synthesised and `aws-cdk-lib` is not installed.

Type-checked, never executed or deployed.

| What | Written as |
|---|---|
| the stage | `app.node.tryGetContext('stage')`, from `cdk.json`'s context |
| functions | one local helper making a `NodejsFunction` per handler file, named `${prefix}-${file.split('/')[1]}`, its `entry` built with `path.join(__dirname, ...)`; each is placed at the call of the helper |
| the REST, HTTP and WebSocket APIs | `OrdersApi`, a construct of the app's own in `lib/orders-api.ts`, handed the functions as props: `rest.root.addResource('orders').addResource('{id}')`, `HttpApi.addRoutes`, `WebSocketApi` with `connectRouteOptions` and `addRoute` |
| the function URL | `receipt.addFunctionUrl()` |
| what reads the queue, the topic, the table's stream and the bucket | `addEventSource(new SqsEventSource(...))`, `new DynamoEventSource(table)`, `topic.addSubscription(...)`, `bucket.addEventNotification(...)` |
| the rules and the schedule | `events.Rule` with `eventPattern` (the source an imported constant), and `Schedule.cron({ minute: '0', hour: '2' })`, which is `cron(0 2 * * ? *)` |
| the workflow | a chain, `reserve.next(charge).next(new sfn.Succeed(...))`, written out as the States Language the CDK synthesises |
| what code sends to | `environment`, each an attribute of the construct: `placed.queueUrl`, `table.tableName` |
