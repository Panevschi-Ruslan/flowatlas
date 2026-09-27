# nest-mount-empty

`nest-context-path` with the environment files novu commits: every one of them
leaves the mount empty (R144).

`api` versions by URI with `prefix: \`${CONTEXT_PATH}v\``, and `CONTEXT_PATH` is
read from `API_CONTEXT_PATH`. Its two committed environment files are
`.env.example`, which writes `API_CONTEXT_PATH=`, and `src/.env.production`,
which writes `API_CONTEXT_PATH=""`. The routes are still recorded as
`/${…}v1/orders` and `/${…}v1/orders/:param`, with the `route-path-dynamic` row
R89 writes, and each carries `mount` — the setting, the files that set it (none)
and how many files there are.

`web` asks for `/v1/orders`, `/v1/orders/:id` and `/v1/invoices`.

What the snapshot holds:

- **Two edges, `heuristic`.** The leading part is read from a setting every
  committed environment file leaves empty, so it is taken as the deployment's
  mount and taken as empty — the assumption the client side already makes of a
  base read from a setting. Each edge carries `mountAssumedEmpty:
  ["API_CONTEXT_PATH"]`, and is weaker than a join read in full.
- **Two `route-mount-assumed-empty` rows, level `info`,** one per request joined
  that way, naming the route and the setting.
- **One plain row.** `/v1/invoices` is served by nothing, mount or no mount.

Built from the repository root:

```
pnpm flowatlas build --config fixtures/nest-mount-empty/flowatlas.config.json
```
