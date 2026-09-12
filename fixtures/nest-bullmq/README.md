# nest-bullmq fixture

Queues, where the channel is the **queue name** and the job name is metadata.
`queue.add('send-email', data)` with the queue injected by token, the same call
with a dynamic job name, a queue whose token cannot be resolved at all, and both
consumer shapes: bullmq's `@Processor` + `WorkerHost.process`, and bull's
`@Processor` + `@Process`.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/nest-bullmq/tsconfig.json --noEmit
```

`node_modules/bullmq`, `node_modules/@nestjs/bullmq` and
`node_modules/@nestjs/bull` are hand-written stubs (committed).

## Why three packages

`@Process` has never existed in `@nestjs/bullmq`; it is the bull-era decorator
and lives in `@nestjs/bull`. §10 asks for both consumer shapes, so the fixture
declares both packages — which is what a repo mid-migration actually looks like —
rather than putting a decorator in a stub that the real library does not export.
All four names (`bullmq`, `@nestjs/bullmq`, `bull`, `@nestjs/bull`) are detection
keys for the single `bullmq` adapter (§7), so having two of them changes which
adapters run not at all.

`Job` is folded into the `@nestjs/bull` stub instead of adding a `bull` package:
it is a parameter type, never a call receiver, so no adapter reads it — the same
shortcut `nest-typeorm` takes with `InjectRepository`.

## Producers — `src/mail/mail.service.ts`

| Call site | Line | Channel | `meta.kind` | `meta.jobName` | Confidence | `unresolved.reason` |
|---|---|---|---|---|---|---|
| `mail.add('send-email', job, { attempts: 3 })` | 26 | `mail` | `job` | `send-email` | static | — |
| `digest.add('send-digest', job)` | 32 | `digest` | `job` | `send-digest` | static | — |
| `mail.add(jobName, job)` | 38 | `mail` | `job` | `null` | static | — |
| `queue.add('build-report', job)` after `new Queue(queueName)` | 46 | none | `job` | `build-report` | heuristic | `channel-dynamic` |

The queue name is never written at the call site: it comes from the
`@InjectQueue('mail')` / `@InjectQueue('digest')` tokens on the constructor
parameters (`mail.service.ts:18-19`). `channel:mail` carries
`meta.channelKind: "queue"` (§12).

Line 38 stays **static**: a dynamic *job* name does not make the *channel*
dynamic, because the channel still comes from the token. Only `meta.jobName`
goes null. Line 46 is the opposite case — the job name is a literal but the queue
was constructed from a variable, so there is no token and no channel.

## Consumers

| Handler | File:line | Channel | `meta.queue` | Job names | Confidence | `unresolved.reason` |
|---|---|---|---|---|---|---|
| `@Processor('mail')` + `process(job)` (WorkerHost) | `src/mail/mail.processor.ts:16` | `mail` | `mail` | `["send-email","send-digest"]` | static | — |
| `@Processor('mail')` + `@Process('send-email')` | `src/mail/legacy-mail.processor.ts:15` | `mail` | `mail` | `send-email` | static | — |
| `@Processor('mail')` + `@Process()` | `src/mail/legacy-mail.processor.ts:22` | `mail` | `mail` | `null` | static | — |
| `@Processor()` + `process(job)` | `src/mail/anonymous.processor.ts:11` | none | `null` | — | heuristic | `channel-dynamic` |

The bullmq shape yields **one** consumer for the whole class, on `process`, with
`meta.jobNames` read from the literal `case` labels of `switch (job.name)`
(`mail.processor.ts:18,21`). The bull shape yields **one consumer per `@Process`
method**. Both land on `channel:mail`, which therefore has one node, one
producer set and three consumers.

None of these is a P01 entry, so every consumer here carries
`meta.entryId: null`.

## Deliberately unresolvable constructs

| Construct | Where | Reason it must produce |
|---|---|---|
| `new Queue<ReportJob>(queueName)` with a parameter | `src/mail/mail.service.ts:45` | `channel-dynamic` — no token to read the queue name from |
| `@Process()` with no argument | `src/mail/legacy-mail.processor.ts:22` | `meta.jobName: null`; must not crash |
| `@Processor()` with no argument | `src/mail/anonymous.processor.ts:9` | `channel-dynamic`; must not crash |

`expected.graph.json` is deliberately absent: it is generated once the P04 passes
exist and reviewed as a diff.
