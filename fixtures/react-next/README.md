# react-next

Two repositories that ship as one product, and the pair exists to prove one
sentence: a click in a React component reaches a route a Next.js file-system
router answers, and the tool can say so from a different checkout.

`web` is a browser. The button, the hook and the module that writes the request
are three separate files, which is the ordinary React shape and the thing that
makes it different to read: there is no class graph between the screen and the
address, only functions calling functions.

`shop` is both a browser and a server. Its routes are declared by where its
files are — `app/api/orders/[id]/route.ts` exporting `GET` and `PATCH` is two
ways in at `/api/orders/:param` — and nothing in any of those files says so.
It also holds the two things that have no equivalent anywhere else the tool
reads:

- **a server action**, a boundary between two processes with no address at all.
  The screen imports the function and calls it; the bundler turns that into a
  request. The import is the only evidence, and it is enough.
- **`middleware.ts`**, the guard equivalent, which applies by matcher rather
  than by being named on a route.

`shop` is also the fixture for a repository read by both halves of the tool at
once. It is read by the server reader, which opens `.ts` and `.tsx` alike, and
that reader asks the frontend adapter to read the browser half through the same
parsed project. So one directory produces one graph holding the screens, the
server action, the route handlers and — this is the part that used to be
missing — the data layer:

- `lib/orders-store.ts` is a data layer written as a module of exported
  functions, which is the ordinary shape here because there is no container to
  ask for a repository. Four queries on one model, and the route handlers and
  the server action reach them, so a flow that starts at a button with no
  address in it ends at a write. Before R57 this file produced nothing at all,
  and the reason was which reader ran rather than how the queries are written.

Two things are deliberately left unread, each with a row in the output saying
so rather than a silence:

- `useResource(props.resourcePath)` builds its address from a property of the
  screen, so following it outward settles nothing;
- nothing here declares which component a Next.js `layout.tsx` wraps, so a
  screen's surroundings are not part of the graph.

One more row is there for the same reason and is worth naming, because it is
new and it is not a gap in this fixture: `pages/api/legacy-orders.ts` answers on
a response object whose type this fixture does not install, so the call to it is
reported as a dynamic receiver at `info` level. That row is the server half
saying which call it could not follow, which is what it is for.
