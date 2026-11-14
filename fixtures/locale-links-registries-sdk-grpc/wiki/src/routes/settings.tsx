import { Route, Switch } from 'react-router-dom';
import useSettingsEntries from '../hooks/useSettingsEntries';

/** The settings screens, one route per entry. */
export default function SettingsRoutes() {
  const entries = useSettingsEntries();
  return (
    <Switch>
      {entries.map((entry) => (
        <Route exact key={entry.path} path={entry.path} component={entry.component} />
      ))}
    </Switch>
  );
}
