# prisma-not-generated

A workspace whose Prisma client was **never generated**, which is what a clone
installed with `--ignore-scripts` is: `prisma generate` runs from a postinstall
hook, so `packages/db/generated/prisma` does not exist, and nothing links
`@acme/db` into `api` either. There is no `node_modules/@prisma/client`
anywhere above this fixture. The checker resolves no `PrismaClient` and no
delegate type, which is how a scheduling app's 239 files of Prisma calls went unread
(R97, R146).

What the source states is enough. The call names the model and the operation;
what it takes to know the call is a Prisma call is that its receiver is traced
to a client value, and every step of that trace is written in the repository.

| Call site | Table | Op | How the client is traced |
|---|---|---|---|
| `prisma.user.findMany()` | `users` | read | default import from `@acme/db` -> its entry `index.ts` -> `export default prisma` -> `prisma: PrismaClient` -> `./generated/prisma/client`, which `schema.prisma` names as the client generator's output |
| `client.order.create(…)` | `Order` | write | named import `prisma as client`, the same trace |
| `this.db.order.delete(…)` | `Order` | delete | `db: PrismaClient`, the type `@acme/db` re-exports with `export type { PrismaClient }` |
| `prisma.user.count()` | `users` | read | `const { prisma } = ctx`, `ctx: { prisma: PrismaClient }` |
| `ctx.prisma.order.aggregate({})` | `Order` | read | the same property, reached directly |
| `prisma.user.findUnique(…)` in `lazy.ts` | `users` | read | `const prisma = (await import('@acme/db')).default`, an import written as an expression; `import('@acme/db').then((mod) => mod.default)` in `lastUser` and `const { default: prisma } = await import('@acme/db')` in `someUsers` (R163) are the same statement, read the same way |
| `db.order.updateMany(…)` | `Order` | write | `db: Orders`, `type Orders = Pick<PrismaClient, 'order'>` - the client with less of it visible |
| `tx.order.update(…)` | `Order` | write | `tx: Prisma.TransactionClient`, `Prisma` from the subpath `@acme/db/client`, whose `export * from '../generated/prisma/client'` passes on every name the generated client has |
| `client.order.findFirst()` | `order` | read | `cached ?? new PrismaClient()`, `PrismaClient` from `@prisma/client` |
| `prisma.order.findMany()` in `legacy.ts` | none | - | a local object named `prisma`: nothing traces it to a client, so it is not read |

The table is the model's, as Prisma maps it: `model User` says
`@@map(name: "users")`, so `prisma.user` reads `users`; `model Order` says
nothing, so it is `Order`. The schema asked is the one beside the file the
client was stated in - `packages/db/schema.prisma` for the wrapper. `legacy.ts`
constructs its own client and no schema is readable from `api`, so its call is
named as the call writes it, `order`.

Every edge is `heuristic`, never `static`: the source states what the author
meant, and nothing compiled it.
