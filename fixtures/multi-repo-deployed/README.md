# multi-repo-deployed

A bookshop of three services - `gateway`, `orders`, `billing` - for
`flowatlas check --env` (P117): whether a version can be deployed against what
an environment runs, rather than against `main`.

`v1/` is the whole project. `scripts/deployed-fixture.mjs` makes each service a
git repository with `v1/` committed on `main` and tagged `v1`, then lays the
other directories over it, one commit each, under one author and one date, so
every sha an answer names is the same on every machine:

| Directory | Becomes | What it changes |
|---|---|---|
| `billing-main/` | `billing` `main`, one commit past `v1` | `POST /invoices` requires a `currency`; publishes `invoice.paid` |
| `gateway-branch/` | `gateway` branch `invoice-on-checkout` | the gateway starts calling `POST /invoices` without a `currency` |
| `orders-branch/` | `orders` branch `drop-lookup` | `GET /orders/:id`, which the gateway calls, is removed; a handler of `invoice.paid` is added |

Every repository is left on `main`. `flowatlas.deployed.json` pins them:

| Environment | Runs | What `check` says |
|---|---|---|
| `prod` | `v1` of all three | the gateway branch is deployable; `drop-lookup` is not: the gateway still calls the route it removes (at `src/clients/orders.client.ts:21`), and nothing in prod publishes `invoice.paid` |
| `staging` | `main` of all three | the gateway branch is not deployable: billing's `main` requires the `currency` it does not send; `drop-lookup` loses only the route |
| `canary` | orders at `v9`, a tag nobody made | undecided, exit 2, naming `git fetch --tags` in `./orders` |

In every version billing reads `order.placed` as `customerRef` where orders
sends `customerId` (a contract error), and consumes an `order.*` channel the
rule `billing-reads-no-order-events` forbids: both run everywhere, so every
check lists them under "already deployed" and none fails on them.

`expected.cli/` holds what `flowatlas check` and `flowatlas deployed show` say
(`scripts/cli-snapshots.mjs`); `expected.mcp/` what the server answers about the
check documents (`scripts/mcp-snapshots.mjs`). The tests are
`packages/cli/src/commands/check.test.ts`, `deployed.test.ts` and
`packages/cli/src/git/build-at-ref.test.ts`.
