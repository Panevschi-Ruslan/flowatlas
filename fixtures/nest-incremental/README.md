# nest-incremental

One small NestJS repository, shaped so that every kind of change an incremental
rebuild has to answer differently is possible in it:

- `src/main.ts` installs a global guard, so touching it changes every route.
- `src/app.module.ts` and `src/orders/orders.module.ts` declare modules, so
  touching either decides which classes the container knows about.
- `src/orders/orders.service.ts` is imported by the controller and by the
  module, which is what makes a one-file edit fan out to its dependents.
- `src/billing/billing.client.ts` makes a request whose address comes from a
  setting, so deleting it removes a leaf and leaves its callers unresolved.
- `src/shared/tokens.ts` is only ever imported for the token it declares.

`src/orders/orders.repository.ts` stands in for a data layer and stores nothing,
so it earns the one `db-layer-unread` row in the snapshot: a class named like a
repository that no data operation was read through. `nest-hidden-db` is where
that row is the point rather than a side effect.

`edits/` holds the ordered changes `incremental-equivalence.test.ts` applies to
a copy of this repository. Each one names the rebuild it should produce and is
followed by the same check: the graph an incremental build wrote must equal the
one a `--no-cache` build writes from the same sources, byte for byte.

`expected.graph.json` is the base state only. The result of each edit is checked
by that equivalence rather than by a snapshot, because a snapshot per step would
record what the tool does rather than that the two paths agree.
