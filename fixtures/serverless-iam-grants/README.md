# serverless-iam-grants

A shop's notices as a Serverless Framework service (`notices/serverless.yml`)
whose functions send where their code decides when they run, each allowed
only where the service's role says (P272).

| What | Read as |
|---|---|
| `EventBusName: buses.get(...)` with `Source` and `DetailType` written, the provider's role granting `events:PutEvents` on `!GetAtt ShopBus.Arn` | drawn to `eventbridge/shop-bus/shop.orders/OrderPlaced`, `heuristic`, which the `onPlaced` rule reads; a `channel-from-grant` note |
| `QueueUrl: subscribers.get(...)` in a function whose own `iamRoleStatements` grant `sqs:SendMessage` on `arn:aws:sqs:*:*:*` | nothing drawn: the row stays and says the grant bounds nothing; the provider's statements are not its own |
| `QueueName: ${param:alertsQueue}` with no value under `params`, and `ALERTS_QUEUE_URL: ${param:alertsQueue}` | the queue named by where the parameter is declared, `${…}@params.alertsQueue` (`deployed-name-from-parameter`, a note), so the alert function's send joins the `onAlert` worker |
