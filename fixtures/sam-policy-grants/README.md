# sam-policy-grants

A shop's relay as an AWS SAM template (`relay/template.yaml`), its functions
sending where their code decides when they run - a queue found by listing the
account, a topic or a stream or a function registered at run time - and each
allowed to send only where its policies say (P272).

| What | Read as |
|---|---|
| `QueueUrl: queues.get(event.kind)`, the function granted `SQSSendMessagePolicy` on two queues | drawn to both queues, `heuristic`, `via: grant`; a `channel-from-grant` note in place of the `channel-dynamic` row |
| `TopicArn: topics.get(...)`, the function granted `sns:Publish` on `*` | nothing drawn: the `channel-dynamic` row stays, and says the grant bounds nothing |
| `StreamName: streams.get(...)` under a `Role:` the template declares, its policy granting `kinesis:PutRecord` on the stream | drawn to the stream, which the archive reader's `Kinesis` event reads |
| `FunctionName: targets.get(...)`, the function granted `LambdaInvokePolicy` on `PlaceOrder` | reaches `PlaceOrder`, `heuristic` |
| `SHOP_API: !Sub https://${ShopApi}.execute-api.${AWS::Region}.amazonaws.com/${Stage}` | the template's own API, by the reference the address is built around; `fetch(`${process.env.SHOP_API}/orders`, { method: 'POST' })` joins `POST /orders`, as sure as the deployment |

A grant is where a function may send, not where it does: every edge drawn
from one is a guess, and says so.
