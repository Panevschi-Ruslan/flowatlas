# koa-router-register

A Koa server that keeps its routes under `server/routes` - the directory a
Nitro server serves files from - and registers one of them with koa-router's
`register` (P270).

Type-checked, never executed. `node_modules` holds hand-written stubs for `koa`
and `koa-router`.

## The shapes

- `server/routes/api/jobs/jobs.ts` gives one handler two verbs with the method
  every verb method calls:

  ```ts
  router.register('jobs.:interval', ['get', 'post'], [validate, runJobs]);
  ```

  The address, the verbs as a list, and the middleware as a list whose last
  member answers. Before P270 nothing read it: the call is neither a verb nor a
  mount, so the routes it declares were not in the graph and no row named the
  file. Koa's row now says where `register` keeps each of the three
  (`verbList` in the description), and the reader turns it into a route per
  verb, with `validate` in front of it. A third registration hands its verbs
  as a value decided at run time, which is a `route-verb-unread` row rather
  than a route.
- `server/routes/api/middleware/*.ts` are middleware factories,
  `export default function paging() { return async (ctx, next) => ... }`.
  The counting rule's `nitro-route-file` probe used to count every file under
  `server/routes` that default-exports anything, so each factory - and each
  router a module exports - was a route file nothing read. It now counts a file
  that default-exports an event handler: one of h3's factories, or a function
  written in place that takes the event. A factory taking nothing is not one.
- `server/routes/api/products/products.ts` declares `POST products.list` with
  `paging()` in front of it, the ordinary way.

## What the graph says

`GET` and `POST /api/jobs.:interval`, `GET` and `POST /api/maintenance.sweep`, each
answered by `runJobs` behind `validate`; `POST /api/products.list` behind
`paging()`; `envelope()` in front of all of them; and one
`route-verb-unread` row at `jobs.manual`.
