# sam-parameter-names

An append-only ledger as an AWS SAM template (`ledger/template.yaml`) whose
table and stream are named by parameters the repository gives no value: no
`Default`, no `samconfig.toml`. A clone nobody installed, read as a stranger
reads it (P268).

| What | Read as |
|---|---|
| `TableName: !Ref LedgerTableName`, `Name: !Ref ChangeStreamName` | the table and the stream named by where each parameter is declared, `${…}@Parameters.LedgerTableName` and `${…}@Parameters.ChangeStreamName` (`deployed-name-from-parameter`, a note) |
| `LEDGER_TABLE: !Ref LedgerTableName` in `Globals` | the table, so the recorder's `PutItemCommand` writes onto the table's stream, which the forwarder's `DynamoDB` event reads |
| `kinesis.send(new PutRecordCommand(record))` for each `record` of `records` | the record the `map` callback answers, its `StreamName` the value of `CHANGE_STREAM`, the stream |
| `Stream: !GetAtt ChangesConsumer.ConsumerARN` | the stream the consumer is registered on, so the fan-out reads what the forwarder puts |
| the audit batch, a value of a `Map` read back through `values()` | the queue `AUDIT_QUEUE_URL` names |
| the team batches | a `channel-dynamic` row: the queue URL is looked up in `teamQueues`, which the function fills by listing the account's queues, by a key worked out from each change |

The team queue is read by its worker and written by nothing the source
names; which queue a team's changes go to is decided when the code runs.
