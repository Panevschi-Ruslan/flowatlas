# cloudformation-orders

The deployment of `terraform-orders`, written as two plain CloudFormation
stacks (no SAM transform) over the same handlers, and read as the same graph
(P248; `scripts/deployments-agree.mjs`). Nothing is packaged, validated or
deployed; the templates are read with what `services[].infra.options` gives
them.

Type-checked, never executed or deployed.

| What | Written as |
|---|---|
| the stage | the parameter `Stage`, with no `Default`: `services[].infra.options` gives it `dev`, as `aws cloudformation deploy --parameter-overrides` would |
| the two stacks | `stacks/storage.json` (JSON) declares the table, the queues, the topic and the bus and exports each under `orders-${Stage}-...`; `stacks/orders.yaml` (YAML) declares the functions and imports them with `Fn::ImportValue` |
| deployed names | `FunctionName: !Sub orders-${Stage}-place-order`, one per function, its code in `Code: ../src` for `aws cloudformation package` |
| the REST API | `AWS::ApiGateway::RestApi`, `Resource` and `Method` with a Lambda proxy integration, deployed to the stage `Stage` names by an `AWS::ApiGateway::Stage` |
| the HTTP API | `AWS::ApiGatewayV2::Api`, `Integration` and `Route` (`GET /orders`) |
| the function URL | `AWS::Lambda::Url`, with the `AWS::Lambda::Permission` a public one needs |
| the WebSocket API | `AWS::ApiGatewayV2::Api` with `ProtocolType: WEBSOCKET`, its `$connect` and `subscribe` routes onto an integration whose URI holds the function's ARN |
| what reads the queue and the table's stream | `AWS::Lambda::EventSourceMapping`, its `EventSourceArn` imported from the storage stack |
| what reads the topic | `AWS::SNS::Subscription` of the imported topic, with its permission |
| the rules and the schedule | `AWS::Events::Rule` on the imported bus with an `EventPattern`, and one with `ScheduleExpression: cron(0 2 * * ? *)` |
| the bucket's notification | `AWS::S3::Bucket` with `NotificationConfiguration.LambdaConfigurations`, `invoices/` ... `.pdf` |
| the workflow | `AWS::StepFunctions::StateMachine` with `DefinitionS3Location: ../statemachine/shipping.asl.json`, the file Terraform renders, its placeholders filled by `DefinitionSubstitutions` |
| what code sends to | `Environment.Variables`, each a `Fn::ImportValue` of the storage stack's export, or a `!Ref` of the bucket |
