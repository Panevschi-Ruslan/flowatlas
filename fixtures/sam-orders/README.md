# sam-orders

The deployment of `terraform-orders`, written as an AWS SAM template
(`orders/template.yaml`) over the same handlers, and read as the same graph
(P246; `scripts/deployments-agree.mjs`). Nothing is built, validated or
transformed; the template is read with what `samconfig.toml` gives it.

Type-checked, never executed or deployed.

| What | Written as |
|---|---|
| the stage | the parameter `Stage`, with no `Default`: `samconfig.toml`'s `parameter_overrides = "Stage=\"dev\""` gives it |
| deployed names | `FunctionName: !Sub orders-${Stage}-place-order`, one per function |
| the runtime, the code and the table every function is handed | `Globals.Function`: `Runtime`, `CodeUri: src/` and `Environment.Variables`, merged under each function's own |
| the REST and HTTP APIs | `AWS::Serverless::Api` and `AWS::Serverless::HttpApi` named `dev-orders`, which `Api` and `HttpApi` events point at with `RestApiId` and `ApiId` |
| the function URL | `FunctionUrlConfig` |
| the WebSocket API | `AWS::ApiGatewayV2::Api` with `ProtocolType: WEBSOCKET`, its `$connect` and `subscribe` routes onto an integration whose URI holds the function's ARN |
| what reads the queue, the topic, the table's stream and the bucket | `SQS`, `SNS`, `DynamoDB` and `S3` events, pointing at the resources with `!GetAtt` and `!Ref` |
| the rule and the schedule | `EventBridgeRule` with a `Pattern`, and `Schedule` with `cron(0 2 * * ? *)` |
| the workflow | `AWS::Serverless::StateMachine` with `DefinitionUri: statemachine/shipping.asl.json`, the file Terraform renders, its placeholders filled by `DefinitionSubstitutions` |
| what code sends to | `Environment.Variables`, each a `!Ref` of the resource |
