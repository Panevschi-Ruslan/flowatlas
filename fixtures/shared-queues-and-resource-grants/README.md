# shared-queues-and-resource-grants fixture

Queues kept where the code that uses them does not set them, a job named by
an error caught at the queue's own call, a domain mapped onto a stage the
workspace names, and a grant the CDK writes into a queue's own policy. What
P316 reads:

1. **A static field another module writes.** `Queues` in `jobs/src/queues.ts`
   declares `static mail: Queue` with no value; `setup.ts` writes
   `Queues.mail = new Queue('mail')` once, and `signup.ts` adds through
   `Queues.mail.add('welcome')`: a producer on `mail`. `Queues.audit` is
   written twice (`audit` and `audit-archive`), so which queue it is stays
   unread, with a row.
2. **A field a base class keeps.** In `jobs/src/layers.ts`, `DailyReports`
   adds through `this.queue`, declared by its base as
   `protected readonly queue = new Queue('reports')`; `Exports` hands its
   base `super(new Queue('exports'))`, kept as `constructor(protected
   readonly queue: Queue)`; `Invoices`' base sets `this.queue = new
   Queue('invoices')` in its constructor. Each is read on its own queue.
3. **A job named off a caught error, at the queue's call.** `Notifier.notify`
   in `jobs/src/notifier.ts` adds `error.jobName` in its catch. The try block
   throws the shop's own `Deferred('notice-later')`, so the job is
   `notice-later`; it also calls `push.send(...)` on a client
   `makePushClient()` makes in `push.ts`, whose type the checker reads from
   the installed `push-sdk` types, so a `channel-dynamic` row says the name
   may be read off an error of `push-sdk`.
4. **A mapping's stage the workspace names.** `gateway/infra/main.tf` maps
   `api.shop.example.test/v1` onto `local.stage`, looked up by the
   workspace: the route's `stages` are `sandbox` and `live`.
5. **A grant on the queue's own policy.** `stock/lib/stock-stack.ts` imports
   the role `stock-mover` of account `111122223333` with `mutable: false` in
   a stack of account `444455556666`: the statement added to the role is
   dropped, and `restock.grantSendMessages(mover)` is read as a grant of
   `stock-restock` on the queue's own policy, beside the row that the
   account's own policies for the role are not in the app.
