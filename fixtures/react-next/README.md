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

Three things are deliberately left unread, each with a row in the output saying
so rather than a silence:

- `useResource(props.resourcePath)` builds its address from a property of the
  screen, so following it outward settles nothing;
- `lib/orders-store.ts` is a data layer written as a module of functions, and
  the data-layer reader walks class methods, so no query node comes of it;
- nothing here declares which component a Next.js `layout.tsx` wraps, so a
  screen's surroundings are not part of the graph.
