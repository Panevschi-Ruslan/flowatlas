# front-end-route-branches fixture

Routes and navigations P288 left open (P291): a route table written over a
list's entries, pages a JSX condition chooses between, a locale prefix a
middleware adds, an Angular route's guards and resolvers, and two navigations
from one place to one page.

## wiki (React Router 5)

| What | Where | What the graph says |
|---|---|---|
| a route table over a hook's list | `entries.map((entry) => <Route path={entry.path} component={entry.component} />)`, `useSettingsEntries()` handing back `useMemoized(() => [...]).filter(...)` | `Profile` at `/settings`, `Members` at `/settings/members` |
| an entry pushed onto the list | `items.push({ path: settingsPath('webhooks'), ... })` | `Webhooks` at `/settings/webhooks` |
| an entry added from code | `items.splice(1, 0, { path: settingsPath(extension.id), ... })` | not placed; counts toward `unplaced` |
| names taken out of the item | `extras.map(({ path, screen }) => <Route path={path} component={screen} />)` | `Shortcuts`, `Tokens` placed |
| pages a condition chooses between | `env.PUBLIC_SHARE ? <Switch>SharedPage at /</Switch> : <Switch>SignIn at /</Switch>` | `<Link to="/">` lands on both, `heuristic`, `meta.branch` |
| a screen holding the routes at its own address | `<Route path="/settings" component={SettingsRoutes} />`, `Profile` at `/settings` inside it | `<Link to="/settings">` lands on `Profile` |
| two navigations to one page | `<Link to={startPath()}>`, `<Link to="/start/recent">` | one edge to `Start`, `meta.alsoNavigates: ['/start/recent']` |

## site (Next, next-intl)

| What | Where | What the graph says |
|---|---|---|
| an address without the locale | `<Link href="/search">`, pages under `app/[locale]/`, `middleware.ts` = next-intl's `createMiddleware` | `calls` to `[locale]/search`, `heuristic`, `meta.localePrefix: [locale]`, a `navigation-locale-prefixed` note |
| one the slug page answers | `<Link href="/about-us">` | `[locale]/[slug]` |
| a sum in a template | `` router.push(`/posts/page/${page + 1}`) `` | `[locale]/posts/page/[pageNumber]` |
| a locale written out | `<Link href="/fr">` | `[locale]` as written, `static` |
| a page outside the segment | `<Link href="/admin">`, `app/(admin)/admin` | as written, `static` |
| the locale router's own helpers | `Link as LocaleLink`, `useRouter()` from `createNavigation(routing)` | navigations, joined as above |

## console (Angular)

| What | Where | What the graph says |
|---|---|---|
| a functional guard that does not navigate | `canActivate: [requireSession]` | `calls` from `ReportsComponent`, `meta.guard: canActivate`; on to `SessionService.isSignedIn` |
| a resolver | `resolve: { totals: totalsResolver }` | `calls`, `meta.guard: resolve`, after the guards |
| a guard written in place | `canActivate: [() => !inject(SessionService).isSignedIn()]` | a function node `canActivate@line` |
| a parent's guards and a guard class | `admin`: `canActivate: [requireSession]`, `canActivateChild: [AdminGuard]` | `UsersComponent` through `requireSession`, then `AdminGuard.canActivateChild`, then its own |
| a guard a factory makes | `canActivate: [roleGuard('owner')]` | `calls` to `roleGuard`, `meta.factory` |
| two navigations to one screen | `navigateByUrl('/reports?range=week')`, `navigate(['/reports'])` | one edge, `meta.alsoNavigates: ['/reports']` |
