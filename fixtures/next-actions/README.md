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

## A known gap, deliberately left visible

`OrdersPage` calls `archiveOrder` and `cancelOrder`, and only `cancelOrder` gets
a `calls` edge to its entry. That is not the reader working correctly, and it is
not a fact about built actions either — it is a defect, reproduced here on
purpose so that fixing it has a test.

An entry marked `viaImport` has its callers drawn by
`packages/extractor-react/src/passes/entries.ts`, which resolves the entry's
handler through `ctx.functions.byId(makeSymbolId(repo, file, functionName))`.
That index comes from `moduleFunctions` in `packages/core/src/functions.ts`,
which treats `const x = <arrow>` as a named function and `const x = builder(<arrow>)`
as nothing. So there is no indexed function named `archiveOrder`, and the
callers reference `archiveOrder` rather than the arrow inside it. Beside it sits
a second, independent defect: that pass drops inline handlers altogether, where
the NestJS pass resolves them with `functionAt`, so `archiveOrder` has no
`handles` edge either.

Both belong to `packages/extractor-react`, which is why they are recorded here
rather than fixed here. When they are fixed, two `calls` edges and one `handles`
edge appear in this fixture's snapshot, and that movement is the proof.
