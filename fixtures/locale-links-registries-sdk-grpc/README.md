# locale-links-registries-sdk-grpc fixture

What P291 and P293 left open (P297), read together: a link of the
application's own read through to the link it renders, routes from a
registry's entries, the locales an application declares, `canDeactivate`,
requests written in a class method, the apollo-angular SDK class, Remeda and a
module's default composition, and what a gRPC handler reads off its request.

## wiki (React Router 5)

| What | Where | What the graph says |
|---|---|---|
| a registry's entries as routes | `PluginManager.add([{ ...config, type: Hook.Settings, value: { component } }])` in each plugin, `PluginManager.getHooks(Hook.Settings).forEach((plugin) => items.splice(..., { path, component: plugin.value.component.Component }))` | `CalendarSettings` at `/settings/integrations/calendar`, `AuditSettings` at `/settings/audit` (its `group` is `Workspace`), the `emoji` plugin's entry (another hook) placed nowhere |
| a link of the application's own | `<HelpLink to="/billing">` rendering `` <Link to={`/help${to}`}> `` | `calls` to `HelpBilling`, `meta.wrapper: HelpLink` |
| a request in a method's own body | `class ActivityStore { load() { fetch('/api/activity') } remove = (id) => fetch(...) }` | drawn from `ActivityStore.load` and `ActivityStore.remove` |
| Remeda's data-last pipe | `loadQuietly = piped(getJson, ...)`, `loadQuietly('/api/members')` | `GET /api/members` from `Header` |
| a module's default composition | `export default flow(getJson, ...)`, imported as `loadTeams('/api/teams')` | `GET /api/teams` from `Header` |

## site (Next, no middleware)

`LangLink` hands `withLang(locale, href)` to Next's `<Link>`; the
locales are the ones `generateStaticParams` of `app/[locale]/layout.tsx`
builds (`LOCALES.map((locale) => ({ locale }))`, `en` and `fr`).

| Written | What the graph says |
|---|---|
| `<FooterLink href="/pricing">`, `FooterLink = styled(LangLink)` | `[locale]/pricing`, `heuristic`, `meta.localePrefix`, a `navigation-locale-prefixed` note naming `LangLink` |
| `<Button href="/partners">`, `Button` rendering `<LangLink href={href}>` | `[locale]/partners`, the same way |
| `<LangLink href="/fr">` | `[locale]` as written, `static`: `fr` is a locale the site declares |

## portal (Next, next-intl)

`defineRouting({ locales: ['en', 'de'] })`.

| Written | What the graph says |
|---|---|
| `<Link href="/go/pricing">` | `[locale]/go/[plan]`, the address written without the locale: `go` is shaped like one and is none the portal declares |
| `<Link href="/de/pricing">` | `[locale]/pricing` as written, `static` |

## console (Angular)

- `canDeactivate: [UnsavedChangesGuard]` on the editor's route and
  `canDeactivate: [leaveAdmin]` on the route it is nested in: drawn from
  `EditorComponent` with `meta.leaving`, the route's own first (`order` 0),
  then the parent's (1); its `canActivate` keeps its own order.
- `codegen.yml` writes `src/generated/graphql.ts` (not committed) with
  `typescript-apollo-angular`, `sdkClass: true`, `serviceName: DocumentsSdk`:
  `this.sdk.documents()` and `this.sdk.documentsWatch()` send `Documents`,
  `this.sdk.saveDocument(...)` sends `SaveDocument`, and the operation's own
  service, `inject(DocumentGQL).fetch(...)`, sends `Document`.

## stock and checkout (gRPC)

`stock` loads `stock.proto` with the loader's default, camelCase; its handler
reads `warehouseId` (declared), `product_id` (a `grpc-field-undeclared` row:
the loader hands it as `productId`) and `zone` (a row: the message declares no
such field). `checkout` loads it with `keepCase: true` and reads the answer as
`{ units_left, back_order }`: compared under the server's names, so nothing is
found.
