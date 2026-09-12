# nest-prisma

The table name comes from the property the call was made on, not from a type
argument, which is what the `receiver-prop` override exists for.

| Call site | Expected |
|---|---|
| `this.prisma.order.findMany()` | table `order`, op `read`, static |
| `this.prisma.order.findUnique(...)` | table `order`, op `read`, static |
| `this.prisma.order.create(...)` | table `order`, op `write`, static |
| `this.prisma.order.delete(...)` | table `order`, op `delete`, static |
| `this.prisma.user.update(...)` | table `user`, op `write`, static |
| `tx.order.update(...)` inside `$transaction` | table `order`, op `write`, static |
| `this.prisma.$transaction(...)` | not a query; the client's own method is not on the descriptor |
