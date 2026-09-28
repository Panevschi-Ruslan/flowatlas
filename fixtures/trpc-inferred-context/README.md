# trpc-inferred-context

A tRPC server whose procedures reach the database through `ctx`, with nothing
annotated and nothing installed: no `@trpc/server`, no generated
`@prisma/client`. That is a fresh clone of a scheduling app in miniature, and the shapes
here are the ones its last read-gate files were written in (R157).

What `ctx` is, is written once: `initTRPC.context<typeof createContextInner>()`
in `src/trpc.ts`, and `createContextInner` says it returns
`Promise<InnerContext>`, whose `prisma` is `typeof prisma` - the client
`src/db.ts` annotates as `PrismaClient` from `@prisma/client`. With the
framework installed the checker carries that type to every handler; with nothing
installed the procedure reader does, and records it against each handler's and
each guard's first parameter for the data reader to ask.

| Call site | Table | Held by | How it is read |
|---|---|---|---|
| `ctx.prisma.order.findFirst(…)` in `procedures.ts` | `order` | `orderOwnerProcedure.use@9`, the guard's own node, in front of `orders.mine` | a guard written in place on a starting point declared at the top of a module; `ctx` from the root's context |
| `prisma.auditLog.create(…)` in `procedures.ts` | `auditLog` | `auditedProcedure.use@16`, in front of `orders.stamp` | the same holder, with the client imported rather than handed over |
| `ctx.prisma.user.count()` in `procedures.ts` | `user` | `unusedProcedure.use@23` | a starting point no way in begins from: still code the module holds, and still a query |
| `prisma.order.deleteMany(…)` in `router.ts` | `order` | `orders.clearDrafts@9` | `const { prisma } = ctx`, the member taken out of the context by name |
| `tx.order.updateMany(…)` in `router.ts` | `order` | `orders.archive@15` | `ctx.prisma.$transaction(async (tx) => …)`: `tx` is the client it was handed by |

The guard's node is the one the way in's `guarded_by` edge points at: a function
written in place is named for where it is (`placeOf` in
`packages/core/src/functions.ts`) by the walk that reads its body and by the
reader that draws it in front of the way in, so the two are one node.

What is **not** in the graph:

- `src/orders.integration-test.ts` and `src/__tests__/seed.ts`. A test is not
  read (`isTestFile` in `packages/core/src/test-files.ts`), and the counting rule
  does not count one by the same definition. Before R157 the first was read and
  counted - its spelling matched neither list - and its `seedOrder` query was in
  the graph as though the service ran it. The file skipped by its name says
  nothing; `src/__tests__/` is skipped for its directory's name and carries one
  `test-directory-skipped` row at level `info`.
- `src/metadata.ts`, whose only Prisma call is in a doc comment. The counting rule
  reads code, not comments; before R157 it counted the comment and the read gate
  called the file unread.
- `src/tasks/cron.ts`, which exports a `GET` from a file no file-system router
  serves. The counting rule counts an exported verb only in a file a router
  serves (`route.*`, `+server.*`); before R157 it counted this one as a way in.
