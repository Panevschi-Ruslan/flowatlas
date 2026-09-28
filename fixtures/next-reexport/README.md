# next-reexport

Three ways in, and not one of them is written in the file that serves it. This is
what R99 turned out to be about: a `file` and a `line` that came from two
different declarations, so the pair named a position that does not exist.

`apps/web` declares its addresses and holds no bodies at all. Each route file is
one forwarding line:

- `app/api/webhook/route.ts` forwards `POST` from `@next-reexport/handlers`, a
  sibling member of the workspace. The file is seven lines long and the verb is
  declared at line 20 of the package's `index.ts`;
- `pages/api/legacy.ts` is one line, and the default export it forwards is
  declared at line 26 of the package's `legacy.ts`;
- `app/api/invoices/route.ts` forwards `GET` from a file in the application
  itself, and is the control: the re-export crosses no package boundary, so
  nothing about it can be blamed on the workspace.

Before the fix all three reported the target's line against their own path —
`app/api/webhook/route.ts:20` against a seven-line file, `pages/api/legacy.ts:26`
against a one-line one. Nothing in a snapshot could see it, because a snapshot
records a file and a line and never asks whether the file has that line; the test
that does ask is `packages/core/src/location.test.ts`, and it asks it of every
fixture here.

What to watch is therefore the pair on each entry, not the routes. The node names
the route file and a line inside it — the forwarding line, which is where the way
in is written — and `declaredIn` and `declaredLine` say where the body is. Those
two are separate facts and each half of each pair comes from the file its other
half names.

The `handles` edge is the other half of the ticket. It reaches the target, in the
package and in the application alike, and the target's own node carries the
target's own position. `store.ts` reads a setting and makes a request out of the
process, which are the two things only a walked body produces: they are how this
fixture says the body one package over was read rather than merely pointed at.

There is no `node_modules` here. `apps/web`'s tsconfig maps the package name to
the file, as a monorepo that builds with a bundler usually spells it.
