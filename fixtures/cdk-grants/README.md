# cdk-grants

A shop's stock moves as a CDK app (`stock/lib/stock-stack.ts`): a function
that sends where its code decides when it runs, allowed only where the app
grants it (P272).

| What | Read as |
|---|---|
| `QueueUrl: reasons.get(...)`, `restock.grantSendMessages(move)` and `move.addToRolePolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [writeOff.queueArn] }))` | drawn to both queues, `heuristic`, which the count function's event sources read; a `channel-from-grant` note |
