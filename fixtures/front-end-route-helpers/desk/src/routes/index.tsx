import { lazy } from 'react';
import { Route, Switch } from 'react-router-dom';
import { startPath, pageSlug, findPath, adminPath } from '../lib/paths';
import * as Screens from './screens';

const Login = lazy(() => import('../screens/Login'));
const TeamMembers = lazy(() => import('../screens/TeamMembers'));

/** Every screen of the desk, each path written by a helper the screens navigate with too. */
export default function Routes() {
  return (
    <Switch>
      <Route exact path="/login" component={Login} />
      <Route path={`${startPath()}/:tab?`} component={Screens.Home.Component} />
      <Route exact path={`${findPath()}/:query?`} component={Screens.Search.Component} />
      <Route path={`/a/${pageSlug}`} component={Screens.Article.Component} />
      <Route exact path={adminPath('teams', ':id', 'members')} component={TeamMembers} />
    </Switch>
  );
}
