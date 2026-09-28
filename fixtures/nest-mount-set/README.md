# nest-mount-set

`nest-mount-empty` with one line changed: `src/.env.production` writes
`API_CONTEXT_PATH=api` (R144).

`.env.example` still leaves it empty. One file that sets it is enough: the
deployment it describes serves every route under `/api/`, so taking the mount as
empty would be a guess the repository itself contradicts, and R89's rule stands.

What the snapshot holds:

- **No edge.** Each route carries `mount` with `setIn: ["src/.env.production"]`,
  which is what the linker refuses on.
- **Two rows that name the route behind the hole,** as `nest-context-path` has
  since R137, rather than saying nothing serves the request.
- **One plain row** for `/v1/invoices`.

Built from the repository root:

```
pnpm flowatlas build --config fixtures/nest-mount-set/flowatlas.config.json
```
