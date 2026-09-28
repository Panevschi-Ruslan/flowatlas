# next-hollow

Two repositories, and both of them are here for the same failure: the tool
reporting a clean bill of health on something it did not read.

`shop` holds six ways in and four of them have nothing behind them. Each is a
spelling a real repository uses, and each used to produce an entry — the right
path, the right verb, sometimes a `handles` edge onto a node with nothing in it —
and no row at all:

- `app/api/orders/route.ts` exports the value a call built out of a
  configuration object, which is how the ecosystem's largest repositories write
  every handler they have. The call is in the repository and the body is in the
  library, `rest-kit`, which ships types and no code;
- `app/api/reports/route.ts` exports a property of something else, so all three
  readings of a verb export decline it;
- `app/api/exports/route.ts` takes two verbs out of a table that is a plain
  value rather than a call, which is the spelling next to the one that is read
  (`export const { POST } = serve(…)`, where the pattern sits on a call);
- `pages/api/legacy.ts` is the older router's version of the first: one file, one
  default export, and the export is a value built elsewhere.

`app/api/invoices/route.ts` is the control. It declares its handler in place and
reaches the data layer, so the fixture holds both of the numbers the build now
prints — ways in found, and ways in whose body was read — and proves the new rows
are not raised for a wrapper that was handed a function.

`app/api/products/route.ts` is the line between the two (R153). It is spelled
exactly as the orders route is - a call handed a configuration object - but the
function called, `productsHandler`, is `handlerBuilder` of `lib/products.ts`
under another name, so the handler it returns is written in a body this
repository holds. That is payload's shape, `export const GET = REST_GET(config)`
with `REST_GET` a second name for `handlerBuilder`, and it is read as the entry of
a registration built by a factory is: the factory at the end of the names is the
handler, with `handlerVia: call`, and no row. Before R153 it was read as the orders route is,
because only what the call was handed was looked at and never the function
called. The orders route used to be written with a factory of this repository
standing in for the library, which was the same mistake from the other side;
the library is a package now, so the two routes differ in exactly one fact.

`widget` is the other hat the same failure wears. The configuration calls it a
browser, so it has a reader; nothing in its manifest is a framework any frontend
adapter recognises, so the reader walks it and puts nothing in the graph. It
contributed no node, which `build` used to print as a line of zeroes among the
services and `doctor` used to read as nothing to report. Both now name it: a
graph missing a service is not a graph anybody can be told is healthy.

`doctor` exits 2 over this project for two reasons, and each is enough on its
own. `widget` is one. `shop` is the other: five of its seven ways in have no body
that was read, and a service whose ways in are mostly addresses is one whose
changes the growth check cannot see — a change inside an unread body never adds a
row — so accepting a baseline over it would accept the blindness (R94). This
README used to say `doctor` exits 2 here, which was true for the first reason
only: with `widget` taken out, `doctor` exited 0, before and after `--accept`.
`expected.doctor.shop.txt` holds that case, narrowed to `shop`, and
`expected.doctor.txt` the whole project. A service with a few unread handlers
among many read ones is not refused; its rows are ordinary rows, and `doctor`
prints the two numbers beside them.
