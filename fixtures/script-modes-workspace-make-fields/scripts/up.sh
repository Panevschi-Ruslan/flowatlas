#!/bin/sh
# Each server run in its own package of the workspace.
export PORT=4400
pnpm --filter @shop/ledger dev &
export PORT=4410
npm run serve -w @shop/audit
