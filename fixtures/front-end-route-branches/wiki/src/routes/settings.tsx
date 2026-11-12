import { Route, Switch } from 'react-router-dom';
import useSettingsEntries from '../hooks/useSettingsEntries';
import Shortcuts from '../screens/settings/Shortcuts';
import Tokens from '../screens/settings/Tokens';

/** Pages written as a list in place, each with its screen. */
const extras = [
  { path: '/settings/shortcuts', screen: Shortcuts },
  { path: '/settings/tokens', screen: Tokens },
];

/** The settings screens, one route per entry of the list the menu shows too. */
export default function SettingsRoutes() {
  const entries = useSettingsEntries(true);
  return (
    <Switch>
      {entries.map((entry) => (
        <Route exact key={entry.path} path={entry.path} component={entry.component} />
      ))}
      {extras.map(({ path, screen }) => (
        <Route exact key={path} path={path} component={screen} />
      ))}
    </Switch>
  );
}
