# lambda-answer-helper fixture

Lambda functions behind a REST API whose every answer is built by a helper of
the project's - `respond(status, body)` from `@acme/http-kit`, a shared package
the repository declares and nobody installed. The handler returns what the
helper builds, so the gateway's own reading (an object with the body as text at
`body`) finds nothing; the configuration says once, under
`adapters.entry.request`, that `respond` answers with argument 1 under the
status at argument 0, that `fail` builds a failure `{ code, message }` from
arguments 1 and 2 (P33), and that `readJson` hands back the body (P30).

Type-checked, never executed or deployed. The configuration at the root is the
project; the repository is the fixture itself.

```
./node_modules/.bin/tsc -p fixtures/lambda-answer-helper/tsconfig.json --noEmit
```

reports one error per file that imports `@acme/http-kit` - "Cannot find module"
- and nothing else. That is the state being read: the kit is declared in
`package.json` and not installed.

## The routes

| Route | Body | Answer | Failures | Read because |
|---|---|---|---|---|
| `POST /rentals` | `StartRental`, claimed | `Rental` | `409: Refusal` | a cast on `event.body`, which a body parser in front turned into the object; the helper imported by name |
| `GET /rentals/:param` | - | `Rental` | `404: Refusal` | statuses written as enum members; params `{rentalId:string}` named by the path |
| `POST /rentals/:param/return` | `EndRental`, claimed | `Receipt` | `422: {code:string;message:string}` | `kit.readJson<EndRental>(event)` through a namespace import; status a constant; the failure built by `kit.fail` from two arguments |
| `GET /stations` | - | - | - | the status is worked out at run time: `Station[]` is kept as `statusUnknown`, neither answer nor failure |
| `GET /stations/:param` | - | - | - | a local function also called `respond` is not the kit's helper, so nothing is read as the answer |

Nothing here depends on `@acme/http-kit` being installed: the helper's calls are
matched by the import in the calling file.
