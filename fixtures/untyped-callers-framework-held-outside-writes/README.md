# untyped-callers-framework-held-outside-writes fixture

A plain browser front end whose requests go through a client held by
instances the code hands around with no types, elements the browser
connects, a jobs service whose queues are written onto instances from
outside their classes, and a CDK app naming a queue by a context value no
file sets. `catalog` listens at 4600 and `stock` at 4700. What P336 reads:

1. **A method called on an untyped receiver.** `web/js/health.js`:
   `check(reader)` calls `reader.health()` and `levels(reader)` calls
   `reader.read('/levels')`, `reader` a parameter with no type; `Board`
   keeps a `Reader` in `this.reader` with no type and calls
   `this.reader.health()`. Each call is found as a call of `Reader`'s method
   by what its callers hand the receiver, so `/health` and `/levels` are
   followed out to each `new Reader(...)`: one request per caller under the
   base of the instance it hands (`catalogUp`, `catalogBoard` at 4600;
   `stockUp`, `stockLevels`, `stockBoard` at 4700).
2. **A method the browser calls.** `web/js/elements.js`: `RecentFeed`
   extends `HTMLElement` and requests `/recent` in `connectedCallback`, which
   no code calls. `stockFeed` appends its feed to the page, `previewFeed`
   only makes one: the request is `stockFeed`'s, under 4700. `Ticker` is
   made by `catalogTicker` and `stockTicker` and appended by neither: the
   request stays with each maker, and an `api-client-base-unread` row says
   the browser calls `connectedCallback` on an instance no code read hands
   it.
3. **Fields written from outside the class, and through `super`.**
   `jobs/src/senders.ts`: `Object.assign(mailer, { queue: ... })` gives
   `Mailer.send` the `outbox` queue, `notifier.queue = ...` gives
   `Notifier.notify` `notices`, and `UrgentPusher` hands its options to
   `super(options)`, where `Pusher` lays them over itself: `Pusher.push`
   adds to `urgent`.
4. **A resource named by a context value no file sets.**
   `infra/lib/infra-stack.ts` names the restock queue
   `this.node.tryGetContext('restockQueue')`, which neither `cdk.json` nor
   any other file sets: the function's grant on it is unread with the reason
   that the deployment gives the name when the app is synthesized, rather
   than a grant on a generated name.
