# front-end-navigations fixture

Five front ends, one per router, each navigating between its own screens
(P276), with the server half of the Next application reading a route whose work
is behind an object a factory hands back, the wrapper in front of it, and a
client's default headers.

## storefront (React Router)

| What | Where | What the graph says |
|---|---|---|
| a link | `<Link to="/orders">` in `Home` | `calls` from `Home` to `Orders` - one edge for the pair, carrying the first navigation written (``navigate(`/orders${search}`)``) |
| a link written as an object | `<NavLink to={{ pathname: '/login' }}>` in `Home` | `calls` to `Login`, `meta.link: NavLink` |
| a link with a template | ``<Link to={`/orders/${id}`}>`` in `Orders` | `calls` to `OrderDetail`, route `/orders/:param` |
| a link in place of the page | `<Link to="/" replace>` in `Orders` | `calls` to `Home`, `meta.replace: true` |
| `navigate` from `useNavigate()` | ``navigate(`/orders/${data.id}`)`` in `Home`, `navigate('/orders', { replace: true })` in `OrderDetail` | `calls` to the page; the second `meta.replace: true` |
| the data router's `navigate` | `router.navigate('/login', { replace: true })` in `signOut`, the router `createBrowserRouter` made | `calls` from `signOut` to `Login` |
| a loader's `redirect` | `return redirect('/login')` in `accountLoader` | `calls` to `Login`, `meta.redirects: true` |
| the older forms | `useHistory().push('/orders')` in `Legacy`, `<Route path="/legacy" component={Legacy}>` and `<Redirect to="/legacy">` in `LegacyRoutes` | `Legacy` is a screen at `/legacy`; `calls` from `Legacy` to `Orders`, and from `LegacyRoutes` to `Legacy`, `meta.redirects: true` |
| shown in place of a page | `<Navigate to="/login" replace />` in `Gate` | `calls` to `Login`, `meta.redirects: true`, `meta.replace: true` |
| out of the application | `navigate('https://help.example.com/storefront')` | `navigation-external` (note) |
| no placed screen | `navigate('/archive')`, with one route's path built by a function (`settingsPath()`) | `navigation-unresolved` (`unplaced`, info): the page may be the route not placed |
| written as code, or rooted at a value read at run time | `navigate(next)`, ``navigate(`${window.location.origin}/orders`)`` | `navigation-unresolved` (`dynamic`) |
| the query glued to the path | ``navigate(`/orders${search}`)`` | the orders screen |
| a step back | `navigate(-1)` | nothing |
| default headers | `api.defaults.headers.common['X-Storefront']`, `api.defaults.headers['X-Locale']`, and `Authorization` under a condition | `GET /api/orders/latest` carries `x-locale`, `x-storefront` and is `headersUnread` (the conditional one) |

## shop (Next.js)

| What | Where | What the graph says |
|---|---|---|
| the older router's pages | `pages/index.tsx`, `pages/orders/index.tsx`, `pages/orders/[id].tsx` | screens with `route` `/`, `/orders`, `/orders/:param` |
| `<Link href>` by path and by `pathname` | `pages/index.tsx` | `calls` to the orders page and to `pages/orders/[id].tsx` |
| `useRouter().push` | `router.push('/account')` in `HomePage` | `calls` to the newer router's `app/account/page.tsx` |
| `push` taken out of the router | ``push(`/orders/${id}`)`` in `OrdersPage` | `calls` to `pages/orders/[id].tsx` |
| Next's `Router` | `Router.replace('/orders')` in `OrderPage` | `calls` to the orders page, `meta.replace: true` |
| a server component's `redirect` | `redirect('/orders')` in `app/account/page.tsx` | `calls` to the orders page, `meta.redirects: true` |
| an object of functions a factory hands back | `export default OrdersGateway()`; `OrdersGateway.list()`, `.latest()`, `.remove()` in `pages/api/orders.ts` | the handler `calls` `OrdersGateway.list`, `OrdersGateway.latest`, `OrdersGateway.remove`; `latest` calls `list` through `this`; their requests hang off them; no `OrdersGateway` node and no `object-literal` cause |
| the wrapper's body | `export default withAudit(handler)` | the `withAudit` middleware node `calls` `lib/with-audit.ts:withAudit`, which calls `recordVisit`, which posts to the audit service |
| default headers on a server client | `client.defaults.headers.common['X-Shop'] = 'shop'` | the gateway's requests carry `x-shop` |

## backoffice (Vue Router)

| What | Where | What the graph says |
|---|---|---|
| `<RouterLink to>` and `<router-link :to="{ name }">` | `HomeView.vue` | `calls` to `StockView.vue` |
| `useRouter().push({ name })` | `openItem` in `HomeView.vue` | `calls` to `StockItem.vue`, `meta.byName: true` |
| `this.$router.push` | `open` in `StockView.vue` | `calls` to `StockItem.vue` |
| a name no route gives | `this.$router.replace({ name: 'missing-screen' })` | `navigation-unresolved` (`missing`) |
| a router imported from where it is made | `router.push('/')` in `goHome` of `router/index.ts` | `calls` to `HomeView.vue` |

## kiosk (SvelteKit)

`goto('/menu', { replaceState: true })` in `+page.svelte` is a `calls` edge to
`menu/+page.svelte`, `meta.replace: true`; the menu's load,
`redirect(303, '/')` in `menu/+page.server.ts`, is a `calls` edge from `load`
to the start page, `meta.redirects: true`.

## admin (Angular)

| What | Where | What the graph says |
|---|---|---|
| `navigate([...])` | `this.router.navigate(['/invoices', id])` in `InvoicesComponent.open` | `calls` to `InvoiceComponent`, `meta.navigates: /invoices/:param` |
| `navigateByUrl` on `inject(Router)` | `InvoiceComponent.back` | `calls` to `InvoicesComponent` |
| relative to the route | `navigate([id], { relativeTo })` | `navigation-unresolved` (`dynamic`) |
| no route | `navigateByUrl('/archive')` | `navigation-unresolved` (`missing`) |
| out of the application | `navigateByUrl('https://billing.example.com/portal')` | `navigation-external` (note) |
| a link in a template | `routerLink="/invoices"` | the template reader's `triggers` edge, as before |
| an answer handed back | `InvoicesService.page` returns `http.get(..., { observe: 'response' }).pipe(tap(...))`; `InvoicesComponent.load` subscribes and reads `res.headers.get('X-Total-Count')` | the request's `meta.responseHeaderKeys: ['x-total-count']` |

Nothing is installed but the stubs under each `node_modules`.
