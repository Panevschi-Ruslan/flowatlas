# sam-list-elements

A catalog (`catalog/template.yaml`) that tells several queues of every change,
each queue an element of a list or a value of a map (P272).

| What | Read as |
|---|---|
| `for (const queueUrl of [SEARCH, PRICES]) sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, ... }))` | one send onto each queue the list holds, `sqs/catalog-search` and `sqs/catalog-prices` |
| `for (const queueUrl of listeners.values())`, the `Map` made with two pairs and given a third with `set` | one send onto each value, the feed queue among them |

Each queue is read by the indexer's `SQS` event.
