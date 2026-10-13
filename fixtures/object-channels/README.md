# object-channels fixture

The two shapes a description could name only at an argument index, and therefore
could not name at all (R86). Two services, one house job bus, and every channel
here addressed in a way `channelArg` cannot express:

- **the name is a property of an object argument** — `jobs.queue({ name, data })`
  on the publishing side and `@OnJob({ name, queue })` on the receiving side;
- **the receiver is the channel** — `this.mail.push(payload)`, where `MailQueue`
  states its topic once, in the `super(...)` every instance goes through.

It is also where the **payload path** is measured (R133). `jobs.queue` is handed
a record holding the name and the message together while `@OnJob` hands its
handler the message alone, so the two ends of one channel name two different
values. `"payloadPath": ["data"]` in the configuration is how the description
says which property carries the message; without it the two ends are compared as
they stand and a correct handler is reported as requiring a field nobody sends.

Both are read **from configuration alone**: nothing in `flowatlas.config.json`
names a library, and the sources declare no broker package for an adapter to
detect. `api` and `worker` each hold their own client of the same bus, which is
what a project that has not extracted a shared package looks like.

## What it must produce

```
channels: 4 total, 2 joined, 2 with no handler, 0 with no publisher
```

| Channel | Published at | Handled at | Named by |
|---|---|---|---|
| `thumbnail.generate` | `api/src/orders/orders.service.ts:23` | `worker/src/jobs/jobs.service.ts:26` | `argument-property` at both ends |
| `mail.send` | same file `:31` and `:42` | same file `:31` | `argument-property`, and `base-constructor-argument` for the second publish |
| `index.rebuild` | same file `:37` | — | `argument-property`, written as a shorthand property |
| `digest.send` | same file `:47` | — | `base-constructor-argument` |

`mail.send` is deliberately published twice, once each way, and lands on **one**
node: which of the two shapes an author wrote is a detail of the call site and
never a second channel.

## Deliberately unreadable

| Construct | Where | Must produce |
|---|---|---|
| `TenantQueue` whose `super(tenantTopic())` is a call | `api/src/jobs/queues.ts:62`, reported at the call `orders.service.ts:52` | `channel-dynamic`, a producer with no channel |
| `@OnJob({ name: legacyJobName() })` | `worker/src/jobs/jobs.service.ts:41` | `channel-dynamic`, a consumer with no channel |

Neither may mint a node. A channel that cannot be named is a row, never a node
(R83).

## Watching it fail

Each record was watched failing before it was kept. Removing one `channel` list
from the configuration and rebuilding:

| Removed | What happens |
|---|---|
| the producer's `argument-property` | 4 channels → 3, 2 joined → 1; three rows whose messages name the whole record — `OrdersService.place -> { name: 'thumbnail.generate', data: { orderId } }` |
| the producer's `base-constructor-argument` | 4 channels → 3, `channel:digest.send` disappears; the rows' messages name the *payload* the fallback index pointed at |
| the consumer's `argument-property` | 4 channels → **6**, 2 joined → **0**: `channel:{"name":"mail.send","queue":"mail"}` and `channel:{"name":"thumbnail.generate","queue":"thumbnails"}` appear beside the real nodes. This is R86's cost reproduced exactly — a message layer present and unusable, every channel with one end. |
| the producer's `payloadPath` | `contracts` goes from `identical=2 errors=0` to `drift=2 errors=2`, twice `error missing_required: receiver worker requires orderId; sender api does not send it`, and twice `info extra_field: sender api sends data`. The envelope compared as though it were the message — a limit of static reading reported as somebody's mistake, at **error** severity (R133). |

## What the comparison says

```
contracts: edges=2 shared=0 identical=2 drift=0 unchecked=3 errors=0 …
```

Both joined channels compare, and neither has anything to report. Before the
handlers had a way in they were `no-type-on-receiver` twice — a row for a shape
that cannot be read at all, given for two handlers whose shape is written
plainly a few lines from the publish.

## Type-checked, never executed

```
./node_modules/.bin/tsc -p fixtures/object-channels/api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/object-channels/worker/tsconfig.json --noEmit
```

There are no stubs here: `@nestjs/common` comes from the fixture suite's own
`node_modules`, and everything else is the fixture's own source (R63).
