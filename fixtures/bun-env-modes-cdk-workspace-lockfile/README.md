# bun-env-modes-cdk-workspace-lockfile

Servers `Bun.serve` starts with no port, read by the files the script that
runs them makes Bun load, and a CDK app that is a member of a workspace whose
lockfile pins the CDK's version (P348).

| What | Read as |
|---|---|
| `shop/src/index.ts`: `Bun.serve({ fetch: app.fetch })`, run by `NODE_ENV=production bun src/index.ts`; `.env` says 4100, `.env.development` 4101, `.env.production` 4102 | listening on 4102, `valueFrom` `.env.production`: Bun loads `.env.production.local`, `.env.local`, `.env.production` and `.env` for production, the first of them setting `PORT` winning, and `.env.development` not at all |
| `admin/src/index.ts`: the same, run by `bun --env-file=.env.ci src/index.ts`; `.env` says 4200, `.env.development` 4201, `.env.ci` 4202 | listening on 4202, `valueFrom` `.env.ci`: `--env-file` replaces the files Bun loads of its own |
| `jobs/src/sync.ts` calls `http://localhost:4102/api/products` and `http://localhost:4202/api/reports` | each joined to its route, `shop`'s and `admin`'s |
| `infra/stock`, the service's repository, asks for `aws-cdk-lib` `^2.150.0`; `infra/package.json` declares it a workspace member, and `infra/package-lock.json` pins 2.230.0 | the version is 2.230.0, read past the repository in the workspace that declares it: the role of account `111122223333` imported in a stack of `444455556666` takes nothing, and `ledger.grantWriteData(mover)` and `moves.grantWrite(mover)` are read on the table's and the stream's own policies (a range alone would leave both unread) |
