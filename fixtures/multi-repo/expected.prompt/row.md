# Check: api-path-dynamic

`gap:web|src/app/orders-api.service.ts|api-path-dynamic` — check / action, info in web at `src/app/orders-api.service.ts`

Read from the source by flowatlas, without running it. Steps are in call order; a best guess is a join it inferred, not one the code proves.

## Where · 4

- `src/app/orders-api.service.ts:48`: GET /orders/${…}-summary is built in part at run time, and no route is joined across the part (`${…}`) nobody read (Write the address from literals and constants, or annotate the function with /** @flowatlas-calls METHOD /path */ naming the route it reaches.) — on **GET /orders/${…}-summary** `ui_api_call:web#src/app/orders-api.service.ts:48:12`
- `src/app/orders-api.service.ts:124`: this.http.get<unknown>(this.opaque()) (An annotation already says where this goes, so the row is a record of what could not be read. Nothing to do here.)
- `src/app/orders-api.service.ts:139`: this.http.post<unknown>(this.opaque(), {}) (The address is built at run time. Annotate the method with /** @flowatlas-calls METHOD /path */.)
- `src/app/orders-api.service.ts:140`: this.http.get<unknown>(this.opaque()) (The address is built at run time. Annotate the method with /** @flowatlas-calls METHOD /path */.)

## How to close it

- Annotate the method with `/** @flowatlas-calls METHOD /path */` to say where it goes.
- Or, if it is right as it is, accept it: `flowatlas accept api-path-dynamic --service web --file src/app/orders-api.service.ts --note '<why this one is fine>'`.

## Ask next

- `who_calls({symbol: "ui_api_call:web#src/app/orders-api.service.ts:48:12"})`
- `impact({symbol: "ui_api_call:web#src/app/orders-api.service.ts:48:12"})`
- `get_source({symbol: "ui_api_call:web#src/app/orders-api.service.ts:48:12"})`
- `search({query: "src/app/orders-api.service.ts", kinds: ["gaps"]})`
