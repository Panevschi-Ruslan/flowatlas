# next-actions

One repository whose server actions are written the way the ecosystem actually
writes them: built by a helper rather than declared as functions.

A server action declared outright is an exported function under a `'use server'`
directive, and that is what `cancelOrder` is. The other three are a client asked
for a schema and then handed the work — `actionClient.schema(…).action(fn)` —
and nothing about the export is a function declaration, so a reader looking for
one finds nothing at all. On the repository this was measured against, eleven of
a hundred and thirty-four actions were declared and the other hundred and
twenty-three were built.

What makes them readable is a row in `packages/adapters-entry/src/action-builders.ts`
saying which argument of which method is the action. The fixture holds one of
each case so the rows stay honest:

- `cancelOrder`, declared as a function;
- `archiveOrder`, built by a described library with the action written in the
  call;
- `renameOrder`, built by the same library and handed a named function, which is
  the case where the graph can point at the code behind the boundary;
- `exportOrders`, built by a helper of this repository that no description
  names. It is a boundary all the same, and the run says so in one aggregate row
  rather than leaving the repository looking as though it had three actions.

## What the two defects were, and what closed them

`OrdersPage` calls `archiveOrder` and `cancelOrder`, and for a long time only
`cancelOrder` got a `calls` edge to its entry. Both halves of that are now read,
and this fixture is where the movement shows.

An entry marked `viaImport` has its callers drawn by
`packages/extractor-react/src/passes/entries.ts`. It used to resolve the entry's
handler and then look for calls of *that*, which works only when the handler and
the export are the same name — that is, only for an action declared outright. A
built action is exported under one name and hands its work to another: an arrow
written in the call, or a function declared beside it. So the callers of the
built ones were looked for under a name nobody writes, and none were found. The
pass now finds the export by where it is declared, which is the position the
entry already carries, and draws the caller edges from there; the code behind
the boundary is still what the `handles` edge points at.

For that lookup to answer, the export has to be a function of the graph in the
first place, and it was not: `moduleFunctions` in `packages/core/src/functions.ts`
reads `const x = <arrow>` as a named function and `const x = builder(<arrow>)` as
nothing at all. That remains true there, and deliberately — it is the right
answer for a reader that cannot check what the call returned. The React reader
now indexes an exported `const` built by a call as a function under its own name
(`packages/extractor-react/src/index-functions.ts`), because that is where the
guess pays for itself: the name in the source is the name every caller writes.
Its body is the whole initializer, so `archiveOrder` reaches `archive` under the
name callers know, beside the finer edge from the arrow itself.

The second defect — that the React pass dropped inline handlers altogether,
where the NestJS pass resolved them with `functionAt` — is closed too, and was
half closed by something else entirely. A Next.js repository is read by the
server reader with both file kinds open, so on this fixture `archiveOrder`'s
inline arrow already had a function node, a `handles` edge and a `calls` edge
into the store it writes through, drawn by the server half. A repository read as
a browser alone had no second half to cover for it, so that pass now resolves an
inline handler the same way, and the two halves agree on the node rather than
one of them depending on the other.

One more movement is in the snapshot and is worth naming, because it is the
same reading applied to an export nobody described: `exportOrders` is a function
of the graph now, reaching `withAudit` and `exportAll`, although it is still not
an entry and the aggregate row still says why. The graph says more about it
than it did rather than less.
