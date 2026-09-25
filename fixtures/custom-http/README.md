# custom-http

One repository built on a framework this tool has never heard of, read
entirely from a description in `flowatlas.config.json`.

`minihttp` is not a real package and no adapter detects it. Its stub in
`api/node_modules` declares a `Server` with the ordinary verbs, a `use` that
installs middleware and an `attach` that hangs one server under another — a
spelling close enough to be plausible and different enough that nothing shipped
with the tool would match it by accident. The whole of what makes its routes
readable is the `adapters.entry.http` row beside it, and the reader that reads
it is the same one that reads the four frameworks that do have adapters.

What the fixture proves, in the order the output shows it:

- the four routes are found, with `/orders` in front of three of them although
  that path is written in `app.ts` and the routes are written in
  `orders/orders.routes.ts`;
- `authenticate`, installed on the parent before the mount, is named on every
  route under it, which is the fact a description has to carry to be worth
  anything;
- a second description, `misspelt-routes`, names a type that does not exist.
  It is there on purpose. The failure mode of a configuration-driven reader is
  silence that reads like a clean repository, so it produces a row naming which
  part of it matched nothing rather than a quiet zero.

The service is typed `nestjs` because that is the name of the reader that opens
a TypeScript server repository, not because anything here is written in it —
`hono-worker` does the same. That the type list has no name for "a TypeScript
server built on something you describe yourself" is a wart, and it is the
second one this fixture shows: the description cannot turn its own reader on,
because an adapter is offered the manifest and not the configuration, so
`adapters.force.entry` is what puts it there.
