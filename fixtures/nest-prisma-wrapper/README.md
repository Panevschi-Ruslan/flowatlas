# nest-prisma-wrapper

An ORM reached only through a workspace package: nothing in `src` imports
`@prisma/client`, and every query goes through `@acme/db`, which configures one
client and re-exports it. This is how cal.com reaches its database through
`@calcom/prisma`, and how a great many monorepos do.

This fixture passes without a single line of new code, and that is what it is
here for. A descriptor is chosen by the package that declares the receiver's
*type*, and a wrapper that hands on the library's own types has not changed any
of them: the receiver of `prisma.order.findMany()` is a delegate `@prisma/client`
declares, whatever the name of the package the value arrived through. There is
nothing to follow and nothing to alias.

| Call site | Expected table | Op |
|---|---|---|
| `prisma.order.findMany()` | `order` | read |
| `prisma.order.findUnique(…)` | `order` | read |
| `prisma.order.create(…)` | `order` | write |
| `prisma.order.delete(…)` | `order` | delete |
| `readonlyPrisma.order.findMany()` | `order` | read |
| `prisma.user.update(…)` | `user` | write |

Two things a wrapper can still hide, both of which this fixture avoids and
cal.com does not, and neither of which is a gap in the reader:

**The library has to be in the manifest.** An adapter is detected from the
service's dependencies, so a service that depends on the wrapper and not on the
library gets no prisma descriptor at all. `apps/web` in cal.com depends on
`@calcom/prisma` and never on `@prisma/client`.

**The types have to exist.** Prisma's client is generated, and the coverage
harness installs with `--ignore-scripts` on purpose, so on cal.com there is no
`PrismaClient` declaration anywhere to resolve — every one of its 80 query sites
is reported as a receiver whose type could not be resolved, which is the honest
answer and says so.
