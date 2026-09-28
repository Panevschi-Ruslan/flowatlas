# next-sibling-nest-types

A Next.js application that imports a DTO package built for a Nest API, and is
not itself a Nest application (R143).

`apps/web` answers `GET /api/bookings` from an App Router route. The route calls
`@sibling-types/platform-types`, a workspace member that declares
`@nestjs/common` because its classes carry Nest decorators - a scheduling app's
`packages/platform/types` is the real case.

Since R123 the manifest every adapter gates on is widened sideways along the
service's extent, so `nestjs-http` is on for `web`, and `build` says so:
`web found at arm's length: nestjs-http (through @sibling-types/platform-types)`.
That is right, and stays: the code being read can import Nest.

What was wrong is the question the bootstrap check asked of that manifest. *Is
this a Nest application* is a question about what the package is, and its own
manifest is the only thing that answers it. Asked of the widened one, it wrote a
`bootstrap-not-found` row on `src/main.ts`, telling a Next.js application to set
`services[].bootstrap` for a Nest bootstrap it will never have.

So what to watch is the empty `unresolved` list. The rest of the graph - the
route, and the mapper class and function one package over - is the ordinary
extent reading and is here to show the member was read.
