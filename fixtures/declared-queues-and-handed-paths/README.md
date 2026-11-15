# declared-queues-and-handed-paths fixture

A queue kept in a field set where it is declared, an address whose path a
parameter puts straight after the host, and an API a Terraform workspace
deploys to a stage of its own. What P308 reads:

1. **A queue a field is declared with.** `Mailer` in `jobs/src/mailer.ts`
   keeps `private readonly queue = new Queue('emails')` and adds through a
   layer, `enqueue(name, data)`: the queue is `emails` and each job is the
   one its callers name (`welcome`, `password-reset`). `Invoicer` declares
   the field with no modifiers and `Reporter` a static one, read as
   `Reporter.queue`, both read the same way.
2. **A path straight after a host.** `getJson(path)` in `web/js/api.js`
   fetches `'https://shop.example.test' + path` and `postJson(path, body)`
   the template `` `https://shop.example.test${path}` ``: each request is
   read at its callers - `GET /products`, `GET /products/:param`,
   `POST /orders` - and joins `catalog`'s route for it, never its `/`.
   `postRaw(path, body)` is called by nothing: its path is unread, with an
   `api-path-dynamic` row, and it joins nothing. `jobs/src/sync.ts` does the
   same on the server: `shopDelete` has a `dynamic-http-url` row.
3. **A stage each workspace names.** `billing/infra/main.tf` deploys the
   billing API to `local.env[terraform.workspace].stage`: `sandbox` in the
   default workspace, `live` in `production`. The route's `stages` are both,
   and the note on each of `web/js/billing.js`'s requests names its own:
   `sandbox where none is given`, `live in the workspace production`.
