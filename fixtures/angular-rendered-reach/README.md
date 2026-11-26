# angular-rendered-reach fixture

What P363-P367 left open (P370): a child component a routed screen renders by
its tag, a click handing a loop's element to a method that navigates, client
methods and components whose names the repository writes nowhere else, and
`flowatlas impact` answering as the graph server's tool does. Two
repositories and one configuration, so `flowatlas build` joins them.

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/angular-rendered-reach/catalog-api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/angular-rendered-reach/catalog-web/tsconfig.json --noEmit
```

## The back end - `catalog-api` (Nest)

- `GET /items/:id` (`ItemsController.findOne`) calls
  `ItemsService.findOne`, the method `impact` is asked about.

## The front end - `catalog-web` (Angular)

- The router shows `CatalogPageComponent` at `/catalog`,
  `SettingsPageComponent` at `/settings` and `ReportsPageComponent` at
  `/reports`.
- `CatalogPageComponent`'s template writes `<app-item-card>`: a `calls` edge
  to `ItemCardComponent`, by its selector. The card's button calls
  `ItemsApiService.one`, which requests the route, so `impact` lists the
  screen `/catalog` with `via: GET /items/:param (catalog-api)`, reached
  through the child it renders.
- `AppComponent`'s menu is `@for (entry of entries)` over a constant list,
  each button `(click)="go(entry)"`, and `go(entry)` navigates to
  `[entry.route]`: the click lands on `/settings` and `/reports`, and
  `/help`, which no route answers, is a row naming it. `go`'s own navigation,
  an address read at run time, is a `dynamic` row naming the code.
- `ItemsApiService.oneLegacy` requests the route and nothing calls it; its
  name is written nowhere else in the repository (a comment does not count),
  and its file has no step the reading could not follow: `dead` says
  `likely-dead` with `evidence.unreferenced`, `reach` says `unreached`, and
  `impact` counts it in `unreached` rather than listing it.
- `ItemsLookupService.byKey` is the same, but its file holds a navigation to
  an address no route answers, a step the reading records as one it could
  not follow: it stays a `maybe` row with that `gap`.
- `LegacyBadgeComponent` is rendered, routed and named nowhere: `likely-dead`,
  `unreferenced`, `reach: unreached`. `PromoDialogComponent` is rendered by no
  template but handed on as a value by the card: `likely-dead`, `reach: maybe`.

`expected.mcp` holds the verbose answers, `expected.mcp.compact` the compact
ones (impact, and a flow from the screen at detail 1 and 2), and
`expected.cli` what `flowatlas impact` prints as a tree and as JSON.
