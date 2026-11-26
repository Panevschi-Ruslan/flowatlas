# aliased-fields-workspace-domains-table-grants fixture

Queues a field is given where the checker does not look, domains a Terraform
workspace names, and grants the CDK writes into a table's, a stream's and a
bus's own policy as the version the lockfile pins does. What P322 reads:

1. **A static field written through an alias.** `Registry` in
   `jobs/src/registry.ts` declares `static billing: Queue` with no value;
   `setup.ts` holds the class as `const registry: any = Registry` and writes
   `registry.billing = new Queue('billing')` once, so `Registry.billing.add`
   in `signup.ts` is a producer on `billing`. `Registry.mail` is declared
   `new Queue('mail')`, but `prioritise(Registry)` writes
   `target.mail = new Queue('mail-priority')` through the parameter it is
   handed: two values, so which queue `welcome` adds to stays unread.
2. **A field a class extending the reader sets.** In `jobs/src/layers.ts`,
   `Notifier.notify` adds through `this.queue`, declared `notices`, and
   `UrgentNotifier extends Notifier` opens `urgent-notices` into the same
   field: `notify` runs on both, so its queue is not read. `Reports.run`
   reads `reports`; `WeeklyReports` sets `weekly-reports` but declares
   `run` again without calling `super.run`, so `Reports.run` still reads
   `reports`, and `WeeklyReports.run` reads neither one alone.
3. **A domain the workspace names.** `gateway/infra/main.tf` maps the
   orders API onto `aws_apigatewayv2_domain_name.orders.domain_name`, which
   is `"${terraform.workspace}.orders.shop.example.test"`: the API is served
   at `**.orders.shop.example.test`, `default.orders.shop.example.test` where
   no workspace is selected. The catalogue's mapping looks its domain up by
   the workspace: `sandbox.catalog.shop.example.test`, and
   `catalog.shop.example.test` in the workspace production. `web/js/shop.js`
   calls `https://staging.orders.shop.example.test/v1/orders` and
   `https://catalog.shop.example.test/products`, each joined to its route.
4. **Grants on a table's, a stream's and a bus's own policy.**
   `stock/package-lock.json` pins `aws-cdk-lib` 2.230.0. The mover role of
   account `111122223333` is imported in a stack of account `444455556666`,
   so the CDK takes it as one it cannot change: `ledger.grantWriteData` and
   `moves.grantWrite` are read on the table's and the stream's own
   policies, and `bus.grantPutEventsTo(mover, 'StockMover')` is dropped. The
   auditor is imported `mutable: false, addGrantsToResources: true`, and
   `cdk.json` turns `@aws-cdk/aws-events:requireEventBusPolicySid` on, so
   `bus.grantPutEventsTo(auditor, 'StockAuditor')` is read on the bus's own
   policy.
