import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import './admin/register';
import { adminEntries } from './admin/lists';
import { entriesIn } from './lib/entries';
import { panels } from './lib/panels';
import { sectionsOf } from './lib/sections';

/** Every screen of the docs, one route per entry each registry holds. */
export default function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/docs/guides">Guides</Link>
        <Link to="/admin/users">Users</Link>
        <Link to="/dashboard/usage">Usage</Link>
      </nav>
      <Routes>
        {sectionsOf('docs').map((section) => (
          <Route key={section.path} path={section.path} element={<section.Screen />} />
        ))}
        {entriesIn(adminEntries, 'people').map((entry) => (
          <Route key={entry.path} path={entry.path} element={<entry.Screen />} />
        ))}
        {panels.all().map((panel) => (
          <Route key={panel.path} path={panel.path} element={<panel.Screen />} />
        ))}
      </Routes>
    </BrowserRouter>
  );
}
