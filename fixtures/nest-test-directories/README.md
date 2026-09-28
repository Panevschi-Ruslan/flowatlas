# nest-test-directories

A service that keeps runtime code in a directory named like tests.

`src/fixtures/catalogue.ts` is the price list `OrdersService.create` queries. It
sits in a directory named `fixtures`, which the tool takes to hold tests, so by
default it would not be read. The configuration names it under
`readTestDirectories`, so it is.

| Path | Expected | Why |
|---|---|---|
| `src/fixtures/catalogue.ts` | read: `SELECT price FROM catalogue` → table `catalogue`, reached from `POST /orders` | named in `readTestDirectories` |
| `src/e2e/client.ts` | not read; one `test-directory-skipped` row at level `info`, `sites: 1` | a directory named `e2e`, not named in the configuration |
| `src/test/` (two files) | not read; a second `test-directory-skipped` row, `sites: 2` | a directory named `test`. Each skipped directory keeps a row of its own; `info` rows that count their own sites are not folded into one per reason |
| `src/orders/orders.service.spec.ts` | not read, and no row | a test by its file name, as always |

Watched failing first: before this fixture's change, the configuration key was
rejected. With the key removed, the old reading had no `catalogue` query or
table, and nothing said that `src/e2e/` had been left out.
