# cdk-imported-role-grants

A shop's stock as a CDK app (`stock/lib/stock-stack.ts`): a function running
under a role the account keeps, and one deployed with a user's access key a
secret holds, each sending where its code decides when it runs (P306).

| What | Read as |
|---|---|
| `role: iam.Role.fromRoleArn(this, 'MoverRole', 'arn:aws:iam::111122223333:role/stock-mover')` | every kind left open by the role: the policies the account attaches to it are not in the app |
| `mover.addToPrincipalPolicy(...)` on `writeOff`, `restock.grantSendMessages(mover)` | read as for a role the app creates, so the move function's grants hold both queues - which do not narrow its send, as the account may allow more: its `channel-dynamic` row stays, its hint naming the role |
| `secretObjectValue: { id: SecretValue.unsafePlainText(key.accessKeyId), ... }` and `CREDENTIALS: credentials.secretArn` | the wrapped id is the user's access key: the ship function is drawn to `stock-shipments`, the one queue `shipments.grantSendMessages(shipper)` grants, `heuristic`, with a `channel-from-grant` note |
