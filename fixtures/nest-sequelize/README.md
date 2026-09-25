# nest-sequelize

Sequelize is called on the model itself rather than through an injected
repository, so the receiver is a class of this repository and the only reason
the call is data access at all is that the class extends one declared in
`node_modules/sequelize`. `packagedBaseOf` carries the origin across that
inheritance; the table is whatever `init` or `define` stated, and is in no type.

| Call site | Expected table | Op | Where the name is |
|---|---|---|---|
| `Invoice.findAll()` | `invoices` | read | `Invoice.init(…, { tableName })` |
| `Invoice.findByPk(id)` | `invoices` | read | `Invoice.init(…, { tableName })` |
| `Invoice.create({ amount })` | `invoices` | write | `Invoice.init(…, { tableName })` |
| `Invoice.update(…, { where })` | `invoices` | write | `Invoice.init(…, { tableName })` |
| `Payment.findAll()` | `payments` | read | `connection.define('payments', …)` |
| `Invoice.destroy({ where })` | `invoices` | delete | `Invoice.init(…, { tableName })` |
| `connection.models[name].count()` | none, `dynamic-table-name` | read | — |

The options handed to `init` are read one property at a time rather than as a
whole object. They also hold the connection, and a connection is not a static
value; reading the object as a whole meant one unreadable property lost the one
property that was the answer.

`tableName` wins over `modelName` where both are stated, because the table is
what a reader looking at the database would see.
