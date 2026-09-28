# multi-repo-asyncapi

Three services, one repository, two documents, and one channel that joins them.

`orders` is read. `billing` and `analytics` are services nobody here can open:
each is an AsyncAPI document and nothing else. `orders` publishes
`orders.created`, both documents say they receive it, `billing` says it publishes
`invoice.issued`, and `orders` handles that. Nothing in `orders/src` knows which
of its neighbours has source.

This is the fixture for R79. The claim it exists to hold is that **the joining of
a channel is not code**: a channel id carries no repository half by design, so a
producer that was read and a consumer that was only declared land on the same
node, and `boundaries()` finds the pair there without being told one end is a
document. HTTP needed a route matcher because a URL has holes in it; an address
is an equality.

## The three

| service | what it is | its part |
|---|---|---|
| `orders` | nestjs | publishes `orders.created`, handles `invoice.issued` |
| `billing` | an AsyncAPI **3** document | receives `orders.created`, sends `invoice.issued` |
| `analytics` | an AsyncAPI **2** document | receives `orders.created`, and nothing else |

Two versions on purpose, because the versions are the only part of reading one of
these that is code rather than description.

**Version 3 puts `operations` beside `channels`.** Each operation says what it
does in `action` and which channel it does it to by `$ref`, and the channel's
name is in its `address` field rather than in its key. The keys here are
`ordersCreated` and `invoiceIssued` and the addresses are `orders.created` and
`invoice.issued` — deliberately different, because a reader that took the key
would produce a channel no broker has ever heard of and the join would silently
find nothing.

**Version 2 puts the operation back inside the channel**, under `publish` or
`subscribe`, where the key *is* the address. That is the containment OpenAPI uses
for a verb inside a path item.

**And the two versions' words are opposite.** `analytics` writes `publish`, and
that means analytics *receives*: version 2 named an operation after what somebody
else may do to the channel, which is the confusion version 3 fixed by renaming
`publish` to `receive` and `subscribe` to `send`. This fixture is where that
would be caught, because a reader that took the word at face value still
produces a graph that joins and compares — it just reports the producer's shape
as the consumer's and draws every arrow backwards.

## What each pair is for

| pair | expected |
|---|---|
| `orders → billing` on `orders.created` | `missing_required currency` and `optionality_mismatch total`: the document requires a field the publisher does not send |
| `orders → analytics` on `orders.created` | two `optionality_mismatch` rows. One channel, two declared consumers, both compared |
| `billing → orders` on `invoice.issued` | `type_mismatch amount`: a number in the document, text in the handler. The declared end is the **sender** here |

## What must stay true

**The channel node is not marked as declared.** Every node the document declares
carries `declaredBy` — the producer, the consumer, the entry, the method — and
the channel deliberately does not. A channel belongs to the whole project, which
is why its id has no repository half and why the linker unions the `adapters` of
everything that named it; `channel:orders.created` here says
`adapters: ["asyncapi", "house-bus"]`, which is the truth. Claiming a document
declared the channel would be false the moment a repository that was read names
the same address, which is this fixture.

**Nothing weakens a join edge, because nothing creates one.** For HTTP the linker
draws `http_calls` and has to cap what that edge claims. Here the `emits` and the
`consumes` are each born in their own service's graph and meet at the channel, so
the reader marks its own edges `declared` at birth and there is no join edge to
bound. Same word, no helper.

**Every sentence says which half was believed.** Each finding above ends with
`… was declared by contracts/<file>, not read`, and the party in `contracts.json`
carries `declaredBy` with the same path.

**`document` is how a declared service is configured.** `{ "kind": "asyncapi",
"path": … }`, with the kind naming the reader. The older `openapi: <path>`
spelling still works and is exercised by `fixtures/multi-repo-declared`, which is
the same claim from the other side.

## What is snapshotted here

Both halves. `expected.link-report.json` holds that `billing` and `analytics`
were read by `asyncapi-document`, and that both channels joined with none left
without a publisher or a handler. `expected.project-graph.json` holds the graph
those numbers count — including which edges are `declared` and which are
`static`, which is the difference a person meets when `impact` and `flow` print
what they walk.
