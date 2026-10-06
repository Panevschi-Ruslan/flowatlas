# aws-sdk-not-installed

A library catalogue that publishes through the AWS SDK in a clone nobody has
installed, which is how a serverless repository is usually first read: there is
no `node_modules`, so every client is `any` to the checker and none of them can
say which package declared it. It exists to prove that the publishers are still
read, from what the source states, and that every edge read that way says so by
being `heuristic`.

| Call | Read as | What the source states |
|---|---|---|
| `this.client.send(new PutEventsCommand(...))` in `CatalogueEvents.catalogued` | `eventbridge/library-events/library.catalogue/ItemCatalogued` | `private readonly client = new EventBridgeClient(...)`, with `EventBridgeClient` imported from `@aws-sdk/client-eventbridge` |
| `sqs.send(new SendMessageCommand(...))` in `queueForShelving` | `sqs/library-shelving` | the parameter `sqs: SQSClient`, with `SQSClient` imported from `@aws-sdk/client-sqs` |
| `sns.publish({...}).promise()` in `announceWithdrawal` | `sns/catalogue-withdrawals` | `sns` imported from `./clients`, where it is `new AWS.SNS()` with `AWS` a namespace import of `aws-sdk`: the import between two modules of the repository is followed with nothing installed |
| `mailer.send({...})` | nothing | `Mailer` is a class of this repository, which the checker reads whatever is installed, and it is no client |

The producer, its `calls` edge and its `emits` edge are all `heuristic`: the
source says what the author meant, not what a compiler checked. The same
repository with its dependencies installed reads the same channels at `static`
(`fixtures/aws-sdk-publishers`). None of the three publishing calls leaves a
`call-dynamic-receiver` row: the call graph could not type the receiver, and
the SDK's broker description read the call all the same, so the row the call
graph wrote is taken back (R173). The rows that remain are on calls nothing
read, such as the `.promise()` after `sns.publish(...)`.

No channel has a handler: the subscribers of all three are declared in the
deployment, which is not read yet.
