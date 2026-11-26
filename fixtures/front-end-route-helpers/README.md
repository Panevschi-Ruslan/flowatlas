# front-end-route-helpers fixture

Routes and navigations written the ways P276 left unread (P288): a path a
helper of the repository hands back, a screen a lazy loader's object holds, two
applications in one service with pages at the same addresses, a navigation in
a template's own handler, SvelteKit's plain links, Angular's template
navigations and functional guards, and a factory that does more than hand back
its object of functions.

## desk (React Router 5)

| What | Where | What the graph says |
|---|---|---|
| a path a helper hands back | ``path={`${startPath()}/:tab?`}``, `startPath()` written `env.KIOSK_MODE ? '/' : '/home'` | `Home` at `/`, `/:param`, `/home`, `/home/:param`: both branches, the optional segment left out and put in; `meta.routeGuessed` names the branch-read ones |
| a helper whose answer carries a query | ``path={`${findPath()}/:query?`}`` | `Search` at `/search` and `/search/:param`: the query is no part of the route |
| a `const` in a template | ``path={`/a/${pageSlug}`}`` | `Article` at `/a/:param` |
| a rest parameter joined | `adminPath('teams', ':id', 'members')`, written `'/admin' + (segments.length > 0 ? ... segments.join('/') ...)` | `TeamMembers` at `/admin/teams/:param/members`: the length decided, the segments joined |
| a screen a lazy loader's object holds | `component={Screens.Home.Component}`, `Home = loadScreen(() => import('../screens/Home'))` | the module's default export, through `observer(Home)` |
| a module handing on another's default export | `lazy(() => import('../screens/Login'))`, `Login/index.ts` re-exporting `Login.tsx`'s | `Login` at `/login` |
| a navigation through the history package's history | `history.push(findPath({ query: 'open' }))` in `Home`, `history` made by `createBrowserHistory()` | `calls` to `Search` |
| a link whose address a helper hands back | `<Link to={adminPath('teams', team.id, 'members')}>` | `calls` to `TeamMembers` |
| a navigation through a branch nothing decides | `history.push(startPath())` in `Search` | `calls` to `Home`, `heuristic`, `meta.branch` |
| an address the server sends | `history.push(pageUrl(parent))` | `navigation-unresolved` (`dynamic`) |

## sites (two Next applications in one service)

| What | Where | What the graph says |
|---|---|---|
| a page file handing on another's component | `apps/*/src/app/(app)/page.tsx`: `import Page from './[slug]/page'; export default Page` | the `[slug]` page is at `/` too |
| one address, a page in each application | `<Link href="/">` in each `Header` | `calls` to the navigating file's own application's page, the nearest directory holding a manifest |
| a page only the sibling has | `<Link href="/search">` in the store's `Header` | the store's page by slug, not the blog's search |

## catalog (Next, a factory that does more)

| What | Where | What the graph says |
|---|---|---|
| a factory that makes its client, then hands back its object | `ProductsGateway = () => { const client = axios.create(...); return { list() {...} } }` | `client.get('/products')` held by `ProductsGateway.list` only; the factory's own body is still read |

## stand (SvelteKit)

| What | Where | What the graph says |
|---|---|---|
| a plain link | `<a href="/orders">` | `calls` to `orders/+page`, `meta.link: a` |
| a link with a value in braces | `<a href="/orders/{data.latest}">` | `calls` to `[id]/+page` |
| a handler's `goto` | `on:click={() => goto('/cart')}` | `calls` to `cart/+page` |
| a fragment, a host, an address no page shows | `#top`, `https://help.example.com/stand`, `/missing-page` | nothing; `navigation-external`; `navigation-unresolved` (`missing`) |

## panel (Vue Router)

| What | Where | What the graph says |
|---|---|---|
| `push` in a template's handler | `@click="router.push('/tickets')"`, `router` from `useRouter()` | `calls` from `BoardView` to `TicketsView` |
| `$router` in a template | `@click="$router.replace({ name: 'board' })"` | the page it is written in: no edge, no row |
| a step back | `@click="router.back()"` | nothing |

## console (Angular)

| What | Where | What the graph says |
|---|---|---|
| `navigate` in a template's handler | `(click)="router.navigate(['/queue'])"`, `router` a public constructor parameter | `triggers` from the click to `QueueComponent` |
| `navigateByUrl` in a template's handler | `(click)="router.navigateByUrl('/login')"` | `triggers` to `LoginComponent` |
| one no route answers | `(click)="router.navigate(['/archive'])"` | `navigation-unresolved` (`missing`) |
| a functional guard | `authGuard`: `inject(Router)`, `router.createUrlTree(['/login'])` | a `function` node `calls` `LoginComponent`, `meta.redirects` |
| a guard by address | `endedGuard`: `inject(Router).parseUrl('/')` | `calls` `StartComponent`, `meta.redirects` |
