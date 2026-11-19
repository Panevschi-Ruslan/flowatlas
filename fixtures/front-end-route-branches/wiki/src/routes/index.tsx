import { Route, Switch } from 'react-router-dom';
import env from '../env';
import { startPath } from '../lib/paths';
import SharedPage from '../screens/SharedPage';
import SignIn from '../screens/SignIn';
import Start from '../screens/Start';
import SettingsRoutes from './settings';

/** Every screen of the wiki: one page where it only shares one, the whole wiki otherwise. */
export default function Routes() {
  return env.PUBLIC_SHARE ? (
    <Switch>
      <Route exact path="/" component={SharedPage} />
    </Switch>
  ) : (
    <Switch>
      <Route exact path="/" component={SignIn} />
      <Route path={`${startPath()}/:tab?`} component={Start} />
      <Route path="/settings" component={SettingsRoutes} />
    </Switch>
  );
}
