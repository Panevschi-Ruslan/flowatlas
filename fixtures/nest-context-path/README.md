# nest-context-path

A NestJS service whose every address begins with a mount the deployment sets,
and a browser that asks for those addresses under a base already carrying it.
novu's shape, in miniature (R137).

`api` versions by URI with `prefix: \`${CONTEXT_PATH}v\``, where `CONTEXT_PATH`
comes from a setting that no source settles. So its two routes are recorded as
`/${…}v1/orders` and `/${…}v1/orders/:param`, with one `route-path-dynamic` row
at `src/main.ts` saying why — which is R89's rule and is not changed here.

`web` asks for `/v1/orders`, `/v1/orders/:id` and `/v1/invoices`.

What the snapshot holds:

- **No edge.** A hole may stand for anything, so a match through one is a
  possibility, and an edge claims a fact. Joining here is the prefix-tolerant
  retry R114 declined in `packages/linker/src/ui-link.ts`.
- **Two rows that name the route behind the hole.** Before R137 they said
  "no configured service serves GET /v1/orders" about an address the graph holds
  as `/${…}v1/orders` — on novu, forty-two times. They keep the reason
  `target-route-not-found`, because the request still reaches no route, and now
  say which route answers it once the unread part is left open.
- **One plain row.** `/v1/invoices` is served by nothing whatever the hole holds,
  and keeps the sentence it always had.
- **Still no edge after R144.** Each route carries the facts R144 reads — the
  mount is read from `API_CONTEXT_PATH` — but this service commits no environment
  file at all, and no file to consult is not every file agreeing. The two
  fixtures beside this one, `nest-mount-empty` and `nest-mount-set`, are the same
  service with environment files that do say something.

Built from the repository root:

```
pnpm flowatlas build --config fixtures/nest-context-path/flowatlas.config.json
```
