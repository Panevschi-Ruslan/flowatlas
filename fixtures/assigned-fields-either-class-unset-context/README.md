# assigned-fields-either-class-unset-context fixture

Fields `Object.assign` writes, a field read through a name that may stand
for either of two classes, and a CDK context value no file sets. What P332
reads:

1. **A static field `Object.assign` writes.** `Queues` in
   `jobs/src/registry.ts` declares `mail` and `audit` with no value;
   `setup.ts` opens both with `Object.assign(Queues, { mail: ..., audit:
   ... })`. `audit` in `workers.ts` adds through `Queues.audit`: a producer
   on `audit`.
2. **An instance field `Object.assign` writes from what the constructor is
   handed.** `Mailer`'s constructor lays `options` over itself, and the one
   `new Mailer(...)` hands `{ queue: new Queue('outbox') }`, so `send` adds
   to `outbox`. `Loader.load` lays `JSON.parse(raw)` over itself, which may
   write any field, so `flush` is not read as the `imports` it declares.
3. **A field of either of two classes.** `deliver(target: any)` adds
   through `target.mail`, and is handed `Queues` by one caller and `Archive`
   by the other, each declaring its own `mail`: the producer adds to `mail`
   or `archive-mail`, its `heldIn` saying `Queues.mail` gave the first and
   `Archive.mail` the second, and the call is `bullmq`'s, which both fields
   state, with nothing installed.
4. **A context value no file sets.** `stock/cdk.json` turns
   `@aws-cdk/aws-events:requireEventBusPolicySid` on and the lockfile pins
   `aws-cdk-lib` 2.230.0; the role asks for its grants on the resources.
   `bus.grantPutEventsTo(mover, this.node.tryGetContext('moverSid'))` hands
   a value nothing in the repository sets: the grant is unread, saying it is
   written where `-c moverSid=...` gives an id when the app is synthesized
   and dropped where none is. The function's `STAGE` is that kind of value
   too, an unread setting saying so.
