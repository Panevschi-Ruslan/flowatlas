import { observer } from 'mobx-react';
import { Link } from 'react-router-dom';
import history from '../lib/history';
import { findPath, adminPath } from '../lib/paths';

/** The home screen: a search, and a team's members. */
function Home({ team }: { team: { id: string } }) {
  return (
    <main>
      <button onClick={() => history.push(findPath({ query: 'open' }))}>Search</button>
      <Link to={adminPath('teams', team.id, 'members')}>Members</Link>
    </main>
  );
}

export default observer(Home);
