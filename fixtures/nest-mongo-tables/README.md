# nest-mongo-tables

MongoDB collections named where the code names them: in the driver's chain, and
on the repository classes a project writes over it (R165).

| Call | Expected table | Why |
|---|---|---|
| `db.collection('archived_orders').drop()` | `archived_orders`, delete | named in the chain, by the `mongodb` description's `chain-call` rule |
| `const users = db.collection('users'); users.updateMany(…)` | `users`, write | a `const` bound to a link of the chain is still that link |
| `db.collection(name).deleteOne(…)` | none; one `dynamic-table-name` row | decided at run time |
| `this.orders.findAll()` on `OrdersRepository` | `orders`, read | `collectionName = ORDERS_COLLECTION`, a constant, read because the configuration names `BaseRepository` with `"tableProperty": "collectionName"` |
| `this.products.findById(id)` on `ProductRepository` | `products`, read | `collectionName = 'products'`, a literal |
| `this.coll().find(…)` inside `ProductRepository`'s own finder | `products`, read | a query made through `this` in a class that states its table is on that table |
| `const c = await this.coll(); c.find(…)` inside `OrdersRepository` | `orders`, read | the same, through a constant bound to the accessor |
| `this.audit.list()` on `AuditRepository` | `audit`, read, `tableFrom: inferred-property` | `LegacyRepository` is configured as a bare name, with no `tableProperty`, and its own query hands `this.source` to the collection call, which says the property without configuration (P88) |
| the queries inside `BaseRepository` | none; one `info` row | they run for every class extending it, and each call through one of them is recorded with that class's table |
| the query inside `LegacyRepository` | none; folded into the same `info` row | it runs for every class extending it, as the configured base's do |

The driver's type argument is the shape of a document, never a name: reading it
made a table called `Document` of every untyped collection, and the `mongodb`
description no longer asks it.
