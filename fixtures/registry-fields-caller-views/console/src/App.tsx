import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import './features/clock';
import './features/weather';
import './features/archive';
import './features/mail';
import { listPages } from './lib/pages';
import { listSections } from './lib/sections';
import { shelfPages } from './lib/shelf';
import { listTools, toRoute } from './lib/tools';
import { WidgetRegistry } from './lib/widgets';

/** Every screen of the console, one route per entry of each list. */
export default function App() {
  // A view the caller makes of a reader's entries before the route list maps them.
  const pages = listPages()
    .filter((page) => page.enabled)
    .map((page) => ({ ...page, path: `/app${page.path}` }));
  // A view made by a function of its own: its entries are not read.
  const tools = listTools().map(toRoute);
  return (
    <BrowserRouter>
      <nav>
        <Link to="/widgets/clock">Clock</Link>
        <Link to="/app/home">Home</Link>
        <Link to="/tools/export">Export</Link>
      </nav>
      <Routes>
        {WidgetRegistry.routes().map((widget) => (
          <Route key={widget.path} path={widget.path} element={<widget.Screen />} />
        ))}
        {shelfPages().map((page) => (
          <Route key={page.path} path={page.path} element={<page.Screen />} />
        ))}
        {listSections().map((section) => (
          <Route key={section.path} path={section.path} element={<section.Screen />} />
        ))}
        {pages.map((page) => (
          <Route key={page.path} path={page.path} element={<page.Screen />} />
        ))}
        {tools.map((tool) => (
          <Route key={tool.path} path={tool.path} element={<tool.Screen />} />
        ))}
      </Routes>
    </BrowserRouter>
  );
}
