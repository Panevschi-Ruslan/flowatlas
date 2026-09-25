# angular-client-wrapper fixture

One Angular repository whose requests are all written inside shared wrappers,
so that no request can be read where the network is reached. Each shape is
here once:

| Shape | File | What it must produce |
|---|---|---|
| Pass-through client (`get/post/delete(path)` → `this.url(path, opts)`) | `src/app/shared/api-client.ts` | nothing at the client; one `ui_api_call` per call site in `DealsClient` |
| Template-method base (`getResourcePath()` answered by the subclass) | `src/app/admin/base.service.ts` | one request per subclass call, with the subclass's resource path |
| A base `delete(path)` that really posts to `<path>/delete` | `BaseService.delete` | `POST /admin/:param/parcels/:param/delete`, never `DELETE` |
| A wrapper layered on the base (`postAction` → `post`) | `ParcelService.stop` | `POST /admin/:param/parcels/:param/stop` |
| `let url` extended with a query string | `BaseService.getWithParams` | `GET /admin/:param/parcels/search` |
| A trailing query-string hole, empty or opening with `?` | `ReviewService.list` | `GET /admin/:param/reviews` |
| A lookup into a table written down whole | `CrateService.setCrates` | one `PUT` per table entry, each `guessed: true`, kept on the service |
| Two tables through one wrapper call, one of them no part of the address | `ParcelService.label` | three `POST`s, not six: a finite set the address never reads does not multiply it |

Every request is attributed to the method that decides its address and names
the wrapper it went through in `meta.through`. The fixture has no backend, so
every request is reported as `target-route-not-found`; that is expected.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/angular-client-wrapper/tsconfig.json --noEmit
```
