# trpc-router

A repository whose ways in are not routes, which is what R95 turned out to be
about.

Every boundary here is a *procedure*: a name in a tree of object literals, with a
shape it is sent, a body, and an address that is every key above it. There is no
verb and no path anywhere, and the two files that do have a path — the mounts
under `src/pages/api` — serve the whole tree and say nothing about what is in it.
That is the shape three quarters of one real repository's callable surface has,
and before this fixture the tool read it as two addresses answering every verb
with nothing behind either.

## What to watch

Three ways in, and the interesting thing about each is different.

`orders.list` is the plain case: the address is two keys joined, the body is a
named function, and there is an edge into it. `orders.create` is guarded, and the
guard is written in `src/server/procedures.ts` — nowhere near it — so finding
`isSignedIn` on it means the reading followed the name the chain starts from
rather than reading the chain. Its body is written in place and hands over to one
named function, so `handlerVia` is `call` and the edge goes to `storeOrder`.

`reportsRouter.daily` is the one that was wrong first. It is a member written
**shorthand** — `router({ orders: ordersRouter, reportsRouter })` — and a
shorthand property's name node carries the *member's* symbol rather than the
value's, so following it the ordinary way leads back into the literal it was
written in. The address came out as `daily`, which is not a string any caller
writes. A scheduling app has one such member and nine ways in hang under it. Its two
guards, `isSignedIn` and `isAdmin`, are inherited through two procedure
definitions built on each other, which is the other half of the same walk.

Each also carries `meta.signature` (P35): the input its `.input(...)` checks -
`{customerId:string}` for `orders.list` - and what its resolver answers,
`{day:string;total:number}[]` for `reportsRouter.daily`, which takes none.

All three carry `served`, naming the mount file that answers them. That is the
fact the ticket was about: twenty-nine three-line files and nothing tying them to
the 171 ways in underneath.

## The uncovered case, which is most of the value

`src/pages/api/trpc/reports/[trpc].ts` mounts `reportsRouterFor('daily')`. Nothing
is wrong with it and nothing about it can be read: the tree is the value a call
produced, so there is no name to follow, and the one member of that tree is
written under a computed key, so it has no address either. Two rows —
`procedure-router-unread` naming the file, and `procedure-key-dynamic` naming the
member — and no entry point invented for either.

Both files also keep their `route-handler-unread` row from the file-system reader,
and they should: a `pages/api` file whose default export is a call really does
have no readable handler. What changed is that the row is no longer the only thing
said about a quarter of the API.

## The unread branch

`root.ts` hangs `billing` on a tree imported from `@acme/billing-api`, a package
this repository does not have. The name is followed to nothing — neither a way
in nor a tree — so everything under `billing` is missing, and one
`procedure-branch-unread` row says which branch. Before this member the row was
emitted by the reader and exercised by nothing, so a regression in it would have
passed the gate.

## The client half

`src/client/orders-panel.ts` writes `client.orders.list.query(...)` and
`client.orders.create.mutate(...)`. `orders.list` is there letter for letter, and
it is also the key of the entry point the server half produces — the same string
on both sides, which is what a join needs and what a URL could never be here,
because one tree is served at many URLs and the client's link decides which.

Each call is a `ui_api_call` of kind `rpc` carrying `procedure`, the path, and
`call`, what the server has to have declared it as: `query` for `.query`,
`mutation` for `.mutate`. The proxy is recognised because `createTRPCClient` made
it, which the client description in the React reader names.

The edge from the request to the entry is not in this snapshot, and should not
be: a repository read alone has no linker. The join is the linker's, because a
procedure path may be answered by the repository it is written in or by another
the configuration names, and only the linker sees both; it is compared in
`fixtures/trpc-join`, which has one of each.

## The stubs

`@trpc/server` and `@trpc/client` are hand-written under this fixture's own
`node_modules`. Each says in its own header which kinds it had to get right:
nothing in the server package is a class, and a procedure builder's methods
return another builder rather than a procedure, so a reader that only looked one
call deep would fail here instead of passing. The reading itself asks the checker
for exactly one thing — what a shorthand property's name stands for — and needs no
resolvable type for anything else, which is why it reads the same tree in a fresh
clone as in an installed one.
