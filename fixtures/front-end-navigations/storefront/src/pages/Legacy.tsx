import { Navigate, Redirect, Route, Switch, useHistory } from 'react-router-dom';

/** A screen written the older way: the history `useHistory()` hands back navigates. */
export function Legacy() {
  const history = useHistory();
  const open = () => history.push('/orders');
  return <button onClick={open}>Open</button>;
}

/** The older route form, `<Route component>`, and a redirect shown in place of a page. */
export function LegacyRoutes() {
  return (
    <Switch>
      <Route path="/legacy" component={Legacy} />
      <Redirect from="/old" to="/legacy" />
    </Switch>
  );
}

/** Shown to a visitor with no session: navigates to the sign-in screen in place of itself. */
export function Gate({ allowed }: { allowed: boolean }) {
  return allowed ? <main /> : <Navigate to="/login" replace />;
}
