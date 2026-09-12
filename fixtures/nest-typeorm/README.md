# nest-typeorm fixture

Exercises the P03 level‑1 (`static`) DB path: package known via the declaring
`node_modules/<pkg>` of the receiver's type, entity taken from the type argument of
`Repository<Entity>`, operation taken from the `typeorm` descriptor.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/nest-typeorm/tsconfig.json --noEmit
```

`node_modules/typeorm/index.d.ts` is a hand-written stub (committed). It declares only
what `src/` touches, in the real library's shape, so `resolveTypeOrigin` resolves the
receiver to `node_modules/typeorm` exactly as it would on a real repo. `InjectRepository`
is folded into the same stub instead of adding an `@nestjs/typeorm` package; it is a
decorator, never a call receiver, so no adapter reads it.

## Expected classification — one row per call site

| Call site | file:line | Level / confidence | `meta.op` | `meta.table` | `meta.package` |
|---|---|---|---|---|---|
| `this.orders.find()` | `src/orders/orders.service.ts:22` | 1 / `static` | `read` | `Order` | `typeorm` |
| `this.orders.save(order)` | `src/orders/orders.service.ts:27` | 1 / `static` | `write` | `Order` | `typeorm` |
| `this.orders.delete(id)` | `src/orders/orders.service.ts:32` | 1 / `static` | `delete` | `Order` | `typeorm` |
| `this.orderCache.createQueryBuilder('order')` | `src/orders/orders.service.ts:38` | 1 / `static` | `read` | `Order` | `typeorm` |

Four call sites → four `db_query` nodes, ops `read` / `write` / `delete` / `read` in
source order, all `static`, one `table:nest-typeorm#Order` node shared by all four
`queries` edges (§12 bullet 1).

## The point of the fixture

`orderCache` (`src/orders/orders.service.ts:17`) is a `Repository<Order>` with a
cache-sounding name. It must still be classified level 1 / `static` and emit a
`db_query`, never a `cache_op`: the declaring package is the only "this is data access"
signal (P03 §4, phase-specific invariant 1). A tool that keys on receiver names instead
of on the type origin fails exactly here.

The mirror case — a receiver *named* like a repository whose type is **not** from a DB
package — lives in `fixtures/nest-unknown-orm`.

## Deliberately unresolvable constructs

None. Every call site here resolves to level 1; the fixture must produce **zero**
`unresolved` entries. Degradation is covered by `nest-unknown-orm` (levels 2 and 3) and
by `nest-pg` (`sql-parse-failed`).

`createQueryBuilder` returns `unknown` on purpose: the builder chain is not modelled in
P03, only the call that enters the data layer. If the `typeorm` descriptor does not map
`createQueryBuilder`, the fourth row degrades to `meta.op: null` + `unresolved:
unknown-db-operation` (§10 row 5) and the §12 count of four `static` nodes fails — so
the descriptor must list it as `read`.

`expected.graph.json` is deliberately absent: it is generated once the P03 passes exist
and reviewed as a diff.
