# remix-flat-routes fixture

A repository whose routes are Remix flat routes, read by the reading every
file-system router in this tool shares (P38).

Type-checked, never executed. `node_modules` holds a hand-written
`@remix-run/node` stub.

```
app/routes/api.orders._index/route.ts   loader, action -> GET, POST /api/orders
app/routes/api.orders.$orderId.ts       loader -> GET, action -> DELETE, PUT /api/orders/:orderId
app/routes/_auth.login.ts               action -> POST /login (a layout adds no segment)
app/routes/[sitemap.xml].ts             loader -> GET /sitemap.xml (an escaped dot)
app/routes/files.$.ts                   loader -> GET /files/* (the rest of the path)
app/routes/about.ts                     a page, no loader or action: no entry, no row
```

A loader answers a GET and an action a POST, or the verbs it compares
`request.method` to (P43); each entry keeps `rawPath`, so a
handler's params are named by the route.
