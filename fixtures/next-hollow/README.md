# next-hollow

Two repositories, and both of them are here for the same failure: the tool
reporting a clean bill of health on something it did not read.

`shop` holds five ways in and four of them have nothing behind them. Each is a
spelling a real repository uses, and each used to produce an entry — the right
path, the right verb, sometimes a `handles` edge onto a node with nothing in it —
and no row at all:

- `app/api/orders/route.ts` exports the value a call built out of a
  configuration object, which is how the ecosystem's largest repositories write
  every handler they have. The call is in the repository and the body is in the
  library;
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

`widget` is the other hat the same failure wears. The configuration calls it a
browser, so it has a reader; nothing in its manifest is a framework any frontend
adapter recognises, so the reader walks it and puts nothing in the graph. It
contributed no node, which `build` used to print as a line of zeroes among the
services and `doctor` used to read as nothing to report. Both now name it, and
`doctor` exits 2 over this project rather than 0: a graph missing a service is not
a graph anybody can be told is healthy.
