# nest-redis-v4 fixture

The same transport as `nest-redis-pubsub`, read through the **other** client of
it. The package is `redis`, its current major version spells the subscription
verbs `subscribe`, `pSubscribe` and `sSubscribe`, and the description spelled
two of them lower case and matched exactly — so the pattern and sharded
subscriptions of the most widely installed client for this transport were read
by nothing at all (R135).

Nothing about that is visible from the outside: a repository that installs a
client and never subscribes is ordinary, so the reader found nothing and said
nothing, and the channel had one end.

## Not a stub

`redis` here is the **real package**, installed into the fixture suite's own
`node_modules`. It has to be: what decides whether a call matches is the package
the receiver's type resolves to, and this client declares its types in a
companion package that a hand-written stub would not reproduce. A stub that
resolves differently from the real package makes a fixture prove nothing (R63) —
and it would have proved nothing precisely here, since the resolution is the
thing under test.

Measured with the stub question asked directly: the receiver resolves to
`redis`, so `receiverPackages` needs no third entry, and none was added.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/nest-redis-v4/tsconfig.json --noEmit
```

## What it must produce

| Call | Line | Channel | Consumer lands on |
|---|---|---|---|
| `client.publish('feed.item.added', …)` | 24 | `feed.item.added` | — (producer) |
| `client.subscribe('feed.item.added', fn)` | 29 | `feed.item.added` | `FeedService.onItem` |
| `client.pSubscribe('feed.moderation.*', fn)` | 31 | `feed.moderation.*` | `FeedService.onModeration` |
| `client.sSubscribe('feed.shard.updated', fn)` | 33 | `feed.shard.updated` | `FeedService.onShard` |

```
brokers: channels=3 producers=1 consumers=3 markers=0
```

Each consumer carries the spelling written at the call site in
`meta.decorator` — `subscribe`, `pSubscribe`, `sSubscribe` — and each
subscription gets the entry node and one `handles` edge that R126 established,
so what the handler is given is readable at this end too.

## Watching it fail

With the description holding only the two lower-case verbs it held before —
`subscribe` and `psubscribe`, matched exactly:

```
brokers: channels=1 producers=1 consumers=1 markers=0
```

`channel:feed.moderation.*` and `channel:feed.shard.updated` are absent
entirely, along with their consumers and their entries: not a degraded row, no
row at all.
