/** The shop as `bun --watch` runs it, in development. */
export const devProducts = () => fetch('http://localhost:4101/api/products').then((res) => res.json());

/** The shop as its start script runs it, NODE_ENV exported before bun. */
export const products = () => fetch('http://localhost:4102/api/products').then((res) => res.json());

/** The admin as `bun run serve` runs it alone, and as `local` runs it - NODE_ENV set there but not exported. */
export const devReports = () => fetch('http://localhost:4201/api/reports').then((res) => res.json());

/** The admin as `start` runs `serve`, under the NODE_ENV cross-env gives. */
export const reports = () => fetch('http://localhost:4202/api/reports').then((res) => res.json());

/** The admin as its container runs `serve`, under the Dockerfile's NODE_ENV. */
export const testReports = () => fetch('http://localhost:4203/api/reports').then((res) => res.json());

/** The reports service, under the BUN_ENV compose gives the container it builds. */
export const summaries = () => fetch('http://localhost:4502/api/summaries').then((res) => res.json());

/** Stock, as `make stock` starts it, and as `make dev` builds it with its own PORT. */
export const levels = () => fetch('http://localhost:4300/levels').then((res) => res.json());
export const devLevels = () => fetch('http://localhost:4310/levels').then((res) => res.json());

/** The ledger and the audit, run from scripts/up.sh in their own packages. */
export const entries = () => fetch('http://localhost:4400/entries').then((res) => res.json());
export const events = () => fetch('http://localhost:4410/events').then((res) => res.json());

/** The catalog's routes on a field and on a parameter's default. */
export const catalog = () => fetch('http://localhost:4700/api/products').then((res) => res.json());
export const drafts = () => fetch('http://localhost:4700/api/drafts').then((res) => res.json());
