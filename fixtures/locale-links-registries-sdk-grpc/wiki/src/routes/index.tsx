import { Route, Switch } from 'react-router-dom';
import HelpBilling from '../screens/HelpBilling';
import Home from '../screens/Home';
import SettingsRoutes from './settings';

/** Every screen of the wiki. */
export default function Routes() {
  return (
    <Switch>
      <Route exact path="/" component={Home} />
      <Route path="/help/billing" component={HelpBilling} />
      <Route path="/settings" component={SettingsRoutes} />
    </Switch>
  );
}
