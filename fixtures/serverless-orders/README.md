# serverless-orders

The deployment of `terraform-orders`, written as a Serverless Framework service
(`orders/serverless.yml`) over the same handlers, and read as the same graph
(P57; `scripts/deployments-agree.mjs`).

Type-checked, never executed or deployed.

| What | Written as |
|---|---|
| deployed names | the framework's own, `<service>-<stage>-<key>`: `orders-dev-place-order`; the stage from `${opt:stage, 'dev'}` |
| the REST, HTTP and WebSocket APIs | `http`, `httpApi` and `websocket` events, on the APIs the framework names `dev-orders` and `dev-orders-websockets` |
| the function URL | `url: true` |
| the queue, its dead-letter queue, the topic, the bus, the table, the bucket | `resources.Resources`, named with `${self:custom.prefix}` |
| what reads them | `sqs`, `sns`, `eventBridge`, `stream`, `s3` and `schedule` events, pointing at the resources with `!GetAtt` and `!Ref` |
| the workflow | the step-functions plugin's `stepFunctions.stateMachines`, its definition written in the file, a step naming one function by its key and the other by its logical id |
| what code sends to | `environment` and `provider.environment`, each a `!Ref` of the resource |

Every state is drawn at the line it is written on in `serverless.yml`.
