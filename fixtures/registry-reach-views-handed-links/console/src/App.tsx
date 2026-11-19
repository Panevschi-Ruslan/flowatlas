import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import './features/billing';
import './features/team';
import './features/extras';
import { listPages } from './lib/pages';
import { consolePanels } from './lib/panels';
import { PluginRegistry } from './lib/plugins';
import { allReports } from './lib/reports';
import { toolRoutes } from './lib/tools';

/** Every screen of the console, one route per entry each registry hands back. */
export default function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/billing">Billing</Link>
        <Link to="/team">Team</Link>
        <Link to="/console/usage">Usage</Link>
        <Link to="/reports/sales">Sales</Link>
        <Link to="/plugins/calendar">Calendar</Link>
        <Link to="/tools/export">Export</Link>
      </nav>
      <Routes>
        {listPages().map((page) => (
          <Route key={page.path} path={page.path} element={<page.Screen />} />
        ))}
        {consolePanels().map((panel) => (
          <Route key={panel.path} path={panel.path} element={<panel.Screen />} />
        ))}
        {allReports().map((report) => (
          <Route key={report.path} path={report.path} element={<report.Screen />} />
        ))}
        {PluginRegistry.routes().map((plugin) => (
          <Route key={plugin.path} path={plugin.path} element={<plugin.Screen />} />
        ))}
        {toolRoutes().map((tool) => (
          <Route key={tool.path} path={tool.path} element={<tool.Screen />} />
        ))}
      </Routes>
    </BrowserRouter>
  );
}
