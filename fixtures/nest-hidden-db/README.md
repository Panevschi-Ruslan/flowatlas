# nest-hidden-db

A data layer nothing recognises, shaped the way the real project shapes one: an
abstract base over a driver, a class per collection extending it, and receivers
named after the thing stored rather than after the layer.

Nothing here is a package, so the origin says nothing. `orders` does not read as
a repository, so the name says nothing either. Before R06 the whole of it was
invisible and the tool said so nowhere: zero `db_query`, zero `table`, and not
one row in `unresolved`. A reader finds two operations and one collection.

| What is expected | |
|---|---|
| `db_query` | none — nothing may be invented from a name alone |
| `table` | none |
| `unresolved` | one `db-layer-unread` row naming `MongoStore` and the key to put it in |

With `adapters.db.localBaseClasses: ["MongoStore"]` the same sources give two
operations and the `Order` collection, and the row is gone. That is the one
change the hint asks for, and it is the whole point of the row.
