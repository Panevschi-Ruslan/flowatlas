# space-message-types fixture

One channel carrying many kinds of message, told apart by a `type` field, and
consumers that choose among them every way the reader knows (P358). Three
repositories and one configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/space-message-types/docs-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/space-message-types/notify-worker/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/space-message-types/realtime-gateway/tsconfig.json --noEmit
```

There is no broker library: `SpaceBus.publish` and `SpaceBus.subscribe` are
ordinary methods, and `adapters.broker.custom` in `flowatlas.config.json` makes
them a producer and a subscriber. Every service subscribes to
`space:*:events`, so every consumer below is a consumer of that one channel.

## The sends - `docs-api/src/spaces/spaces.service.ts`

| Method | How the type is written | Type read |
|---|---|---|
| `publishDoc` | a literal in place | `DOC_PUBLISHED` |
| `addComment` | a typed constant whose `type` is an enum member | `COMMENT_ADDED` |
| `join` | a member of a constant object | `MEMBER_JOINED` |
| `finishExport` | a helper whose answer is written out | `EXPORT_FINISHED` |
| `warnQuota` | a literal in place | `QUOTA_WARNING` |
| `relay` | a parameter typed by the whole union | none: a `message-type-unread` row, the union decided by the caller |

Each type is a node, `channel:space:*:events#<type>` of kind `message_type`,
every publish of it `emits` onto it, beside its `emits` onto the channel.

## The choices - `notify-worker/src/handlers/`

| Consumer | How it chooses | Types, and the handler each runs |
|---|---|---|
| `SpaceEventsDispatcher.dispatch` | `switch`, two cases falling through to one | `DOC_PUBLISHED` `Notices.docPublished`, `COMMENT_ADDED` `SpaceEventsDispatcher.onComment`, `MEMBER_JOINED` and `EXPORT_FINISHED` `Notices.digest` |
| `ExportWatcher.onEvent` | `if (event.type !== 'EXPORT_FINISHED') return;` | `EXPORT_FINISHED` `ExportWatcher.notifyOwner` |
| `AuditTrail.record` | a record of handlers in a field, `this.handlers[event.type]?.(event)` | `DOC_PUBLISHED` `AuditTrail.recordPublish`, `MEMBER_JOINED` `AuditTrail.recordJoin` |
| `ActivityFeed.onMessage` | `if` and `else if` on a destructured `type` | `COMMENT_ADDED` `ActivityFeed.pushComment`, `DOC_ARCHIVED` `ActivityFeed.pushArchive` |
| `RegistryDispatcher.route` | a registry filled when the code runs; the decorator `@OnSpaceEvent('MEMBER_JOINED')` names the type | `MEMBER_JOINED` `WelcomeHandlers.greet`, heuristic |
| `LegacyDigest.onEvent` | `if`, in a class no module registers and nothing injects | `QUOTA_WARNING` `LegacyDigest.mailQuota`, which never runs |

Each handler a choice runs is a consumer of its own, consuming from the type's
node, with `selectedBy` naming the consumer that chose.

## The traps

- `realtime-gateway`'s `StreamRelay.forward` passes every message on without
  reading its type. It is a consumer of the channel and the handler of no type.
- `LegacyDigest` subscribes when it starts, and nothing builds it. Its choice
  is drawn and carries why it never runs, so `QUOTA_WARNING` is published and
  selected by no code that runs: the finding `message-type-unselected`,
  `unsure` because `StreamRelay.forward` passes it on unread.
- `MentionHandler.handle` checks the type and is reached by nothing - not a
  consumer of anything - so no type is drawn onto it and `dead` still says so.
- `DOC_ARCHIVED` is chosen and published by nothing read; `who_emits` with the
  type names `relay`, whose type was not read, as what may send it.

## What an agent asks

```
who_consumes({channel: "space:*:events", type: "MEMBER_JOINED"})   three handlers, how each was chosen
who_consumes({channel: "space:*:events", type: "QUOTA_WARNING"})   unselected, sureness: unsure
search({query: "QUOTA_WARNING"})                                   the type under messages, and the finding
```
