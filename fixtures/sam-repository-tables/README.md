# sam-repository-tables

A shop as an AWS SAM template (`shop/template.yaml`) whose functions write
their tables through a repository base class of its own, each table named by
the class that extends it (P289). Every table declares a stream, and a
function reads each stream.

Type-checked, never executed or deployed.

| Written by | As | Onto | Read there by |
|---|---|---|---|
| `place-order.ts`, `orders.place(order)` | `Repository.save`, `TableName: this.table`; `OrdersRepository` hands `super(process.env.ORDERS_TABLE)`, the template's `!Ref OrdersTable` | `dynamodb/shop-orders` | `OrderChanged` |
| `place-order.ts`, `audit.save(...)` | the same `Repository.save`; `AuditRepository` has no constructor of its own, and is built `new AuditRepository('shop-audit')` | `dynamodb/shop-audit` | `AuditChanged` |
| `save-cart.ts`, `new CartStore().put(cart)` | `Store.put`, `TableName: this.table`, a field `Store` only declares and `CartStore` sets to `'shop-carts'` | `dynamodb/shop-carts` | `CartChanged` |

Each write is drawn where the table is decided - the `this.save(order)` in
`OrdersRepository.place`, the `audit.save(...)` and the `put` in the handlers -
rather than at the base class's one `send`, where the table is a field nothing
there names. Before P289 the field was read where it is written, the three
writes were no producer (a table write is one only where its table is read),
and every stream carried a `stream-no-writer` note.
