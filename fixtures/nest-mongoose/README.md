# nest-mongoose

A mongoose model carries two facts at once, and they come from two different
places. The document type is the type argument of `Model<OrderDocument>`,
exactly as `Repository<Order>` carries its entity; the collection is the string
the model was declared with and is in no type at all.

| Call site | Expected table | Op | Entity |
|---|---|---|---|
| `OrderModel.find({})` | `orders` | read | `OrderDocument` |
| `OrderModel.findById(id)` | `orders` | read | `OrderDocument` |
| `OrderModel.create(order)` | `orders` | write | `OrderDocument` |
| `OrderModel.updateOne(…)` | `orders` | write | `OrderDocument` |
| `new OrderModel(order).save()` | `orders` | write | `OrderDocument` |
| `OrderModel.deleteOne(…)` | `orders` | delete | `OrderDocument` |
| `models[collection].countDocuments({})` | none, `dynamic-table-name` | read | — |

`save()` is the row worth reading twice. The receiver is a document rather than
a model, and a document knows nothing about where it is stored — but it was
made from a model, and the model is what names the collection, so following the
`new OrderModel(…)` it came from answers the question the document could not.

The other shape — `@InjectModel(Cat.name) private catModel: Model<Cat>`, which
is how a Nest repository holds a model — has no declaration the receiver names,
so the locator finds nothing and the call falls back to the type argument. That
is why the descriptor's override is dropped rather than forced: on the NestJS
mongoose sample the five calls come out as `type-arg` with the table `Cat` and
their operations known, where before P18 they had a table and no operation at
all.

The writes are also what `stripImpact` in `@flowatlas/contracts` asks about.
Each of them records `entityTypeId`, so a field a validation pipe strips off a
request body can be checked against the fields of `OrderDocument` rather than
shrugged at — which is the whole difference between `stored` and `unknown` on
that finding. `descriptors/index.test.ts` in `@flowatlas/adapters-db`
demonstrates it on this fixture's own snapshot.
