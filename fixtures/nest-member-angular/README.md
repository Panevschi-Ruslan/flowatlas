# nest-member-angular

A NestJS API one of whose members installs Angular (R159, the Angular half of
R145). Angular is detected for the API - `@member-angular/widgets` declares it,
and the API depends on the widgets - so the Angular reader runs. Before R159 it
then read every class the API's project holds, and two members that Angular is
not supplied to were read as browser code: their `HttpClient` calls became
`ui_api_call` nodes, and their classes were injected with `HttpClient` as if a
page's container built them.

The rule is the one the React reader already asks: **a file is read as Angular
when Angular is supplied to the package that holds it** (`suppliedWith` in
`packages/core/src/adapters/manifest.ts`), asked with the adapter's own
`declaresAngular`.

| Package | Angular in its manifest | Supplied? | Why |
|---|---|---|---|
| `apps/api` (the service) | none | no | a service supplies the framework to everything only when it declares it itself |
| `packages/widgets` | `dependencies` | yes | it installs Angular, so its own files are Angular it runs |
| `packages/sdk` | `peerDependencies` | no | its only dependent is the API, which supplies none |
| `packages/mailer` | `devDependencies` | no | a devDependency is never installed for anybody who depends on the member |

What to watch:

- **In the graph:** `StatusService.status`'s `GET /orders/:param/status` as a
  `ui_api_call`, and `StatusService` injecting `HttpClient`.
- **Not in the graph:** `SdkClient.lookup`'s `GET /customers/:param` and
  `MailPreview.preview`'s `POST /send` as `ui_api_call`, their
  `target-route-not-found` rows, and either class injecting `HttpClient`.
- **Still in the graph:** `SdkClient`, `MailPreview` and their methods, which the
  server reader reads as the API's own code, called from `OrdersController.place`.
