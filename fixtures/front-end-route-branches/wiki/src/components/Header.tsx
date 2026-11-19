import { Link } from 'react-router-dom';
import history from '../lib/history';
import { settingsPath, startPath } from '../lib/paths';

/** The bar on top of every screen. */
export default function Header() {
  return (
    <header>
      <Link to="/">Home</Link>
      <Link to={startPath()}>Start</Link>
      <Link to="/start/recent">Recent</Link>
      <Link to="/settings/members">Members</Link>
      <Link to="/settings">Settings</Link>
      <Link to="/settings/tokens">Tokens</Link>
      <button onClick={() => history.push(settingsPath('webhooks'))}>Webhooks</button>
    </header>
  );
}
