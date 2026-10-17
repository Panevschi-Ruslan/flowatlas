# Check: api-path-dynamic

`gap:web|src/app/orders-api.service.ts|api-path-dynamic` — check / info, action in web at `src/app/orders-api.service.ts`

Read from the source by flowatlas, without running it. Steps are in call order; a best guess is a join it inferred, not one the code proves.

## Where · 3

- `src/app/orders-api.service.ts:124`: this.http.get<unknown>(this.opaque()) (An annotation already says where this goes, so the row is a record of what could not be read. Nothing to do here.)
- `src/app/orders-api.service.ts:139`: this.http.post<unknown>(this.opaque(), {}) (The address is built at run time. Annotate the method with /** @flowatlas-calls METHOD /path */.)
- `src/app/orders-api.service.ts:140`: this.http.get<unknown>(this.opaque()) (The address is built at run time. Annotate the method with /** @flowatlas-calls METHOD /path */.)

## Ask next

- `search({query: "src/app/orders-api.service.ts", kinds: ["gaps"]})`
