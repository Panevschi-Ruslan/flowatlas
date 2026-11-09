# nest-prisma-base-url

A NestJS service whose Prisma client was **never generated** and is imported
by the path the tsconfig's `baseUrl` places it at (P270): `import {
PrismaClient } from 'src/generated/prisma/client'`. The schema's generator is
the newer `prisma-client`, writing to `../src/generated/prisma`, and nothing is
under that directory, which is what a clone installed with `--ignore-scripts`
is.

`src/...` reads like a package called `src`, and before P270 that is what it
was taken for: `PrismaService extends PrismaClient` had a base out of a package
nobody describes, so every `this.prisma.<model>.<op>(...)` through it read as
nothing - no query, no table, and no row naming the file.

## What is read

| Call site | Table | Op | How the client is traced |
|---|---|---|---|
| `this.prisma.coupon.findMany(...)` inside `TE.tryCatch(() => ...)` | `coupons` | read | `prisma: PrismaService`, `extends PrismaClient`, `src/generated/prisma/client` under `baseUrl: "./"`, which `prisma/schema.prisma` names as the client's output |
| `this.prisma.coupon.create(...)` | `coupons` | write | the same |
| `this.prisma.coupon.deleteMany(...)` | `coupons` | delete | the same |
| `this.prisma.apiToken.findUnique(...)` in the guard | `ApiToken` | read | the same, in a guard rather than a service |
| `prisma.coupon.findMany()` in `coupon-codes.ts` | `coupons` | read | `const prisma = sharedPrisma()`, a function of the repository that writes its return type, `PrismaService` |

`model Coupon` says `@@map("coupons")`, so `prisma.coupon` reads `coupons`;
`model ApiToken` says nothing, so it is `ApiToken`. The schema is the one at
`prisma/schema.prisma`, found by walking up from the file the client is stated
in.

A `paths` alias reaches the same directory (`@db/*` ->
`src/generated/prisma/*`); `coupons.service.ts` imports a type through it, and
the unit tests read a client imported that way as well.

Every edge is `heuristic`: the source states what the author meant, and nothing
compiled it.
