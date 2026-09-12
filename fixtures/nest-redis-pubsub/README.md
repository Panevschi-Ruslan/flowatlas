# nest-redis-pubsub fixture

Redis pub/sub, the case with no decorator anywhere: producers are
`redis.publish(channel, message)` calls and consumers have to be found by pairing
a `subscribe(channel)` with the `on('message', …)` listener on the same
connection.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/nest-redis-pubsub/tsconfig.json --noEmit
```

`node_modules/ioredis` is a hand-written stub (committed). It is deliberately a
different file from the `ioredis` stub in `fixtures/nest-leaves`: that one
declares the key/value half of the library for the cache adapter, this one the
pub/sub half. Each fixture stubs exactly the surface it uses.

Every channel here gets `meta.channelKind: "channel"` and every producer
`meta.kind: "message"`.

## Producers — `src/cache/cache-publisher.service.ts`

| Call site | Line | Channel | Confidence | `unresolved.reason` |
|---|---|---|---|---|
| `redis.publish('cache.invalidate', JSON.stringify(event))` | 19 | `cache.invalidate` | static | — |
| `redis.publish(CACHE_CHANNELS.warm, JSON.stringify(event))` | 25 | `cache.warm` | static | — |
| `redis.publish('cache.invalidate', …)` inside `.then()` | 34 | `cache.invalidate` | static | — |
| `redis.publish('cache.raw', JSON.stringify(raw))` | 43 | `cache.raw` | static | `payload-type-unknown` |
| `redis.publish(channel, JSON.stringify(event))` | 50 | none | heuristic | `channel-dynamic` |

`meta.channelVia`: `literal` (19, 34, 43), `const` (25), `dynamic` (50).

The payload type is the type of the value being serialised, not of the string
handed to redis: `CacheInvalidated` on 19 and 34, `CacheWarmed` on 25. Line 43
takes `any`, so there is nothing to register and the `emits` edge carries
`payload-type-unknown` instead of a `params` entry (D6, I5 — a null type id is
never written).

Line 34 is the callback row: the call is inside an arrow passed to `.then()` and
must be attributed to `invalidateAll`, the enclosing method, giving
`channel:cache.invalidate` two producers.

## Consumers — `src/cache/cache-subscriber.service.ts`

| Subscription | Line | Listener | Channel | Consumer lands on | Confidence | `unresolved.reason` |
|---|---|---|---|---|---|---|
| `invalidations.subscribe('cache.invalidate')` | 23 | line 24, delegates to one method | `cache.invalidate` | `CacheSubscriberService.handleInvalidation` | static | — |
| `raw.subscribe('cache.raw')` | 30 | lines 31-34, two calls in the body | `cache.raw` | `CacheSubscriberService.onModuleInit` | heuristic | `consumer-handler-unresolved` |

The first listener body is exactly `this.handleInvalidation(message)`, so the
consumer moves to that method — an arrow function is never the handler. The
second body calls `audit` **and** `handleRaw`, so there is no single method to
point at and the consumer falls back to the enclosing method with a reason
recorded (I3: the degradation is never silent).

There is no P01 entry for either, so both carry `meta.entryId: null`.

## Deliberately unresolvable constructs

| Construct | Where | Reason it must produce |
|---|---|---|
| `channel` parameter | `src/cache/cache-publisher.service.ts:50` | `channel-dynamic`, hint `add @Emits('<topic>') on CachePublisherService.publishTo` |
| `raw: any` payload | `src/cache/cache-publisher.service.ts:43` | `payload-type-unknown` |
| listener body with two calls | `src/cache/cache-subscriber.service.ts:31` | `consumer-handler-unresolved` |

`expected.graph.json` is deliberately absent: it is generated once the P04 passes
exist and reviewed as a diff.
