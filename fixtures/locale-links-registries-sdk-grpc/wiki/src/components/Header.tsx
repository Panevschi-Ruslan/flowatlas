import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import loadTeams from '../lib/load-teams';
import { loadQuietly } from '../lib/quiet';
import { activity } from '../stores/ActivityStore';
import { HelpLink } from './HelpLink';

/** The bar at the top of every screen. */
export default function Header() {
  useEffect(() => {
    void loadTeams('/api/teams');
    void loadQuietly('/api/members');
    void activity.load();
  }, []);
  return (
    <nav>
      <Link to="/settings/integrations/calendar">Calendar</Link>
      <Link to="/settings/audit">Audit log</Link>
      <HelpLink to="/billing">Billing</HelpLink>
    </nav>
  );
}
