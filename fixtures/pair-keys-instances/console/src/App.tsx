import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { getDock, makeBin, makeShelf } from './lib/shelves';
import { PAGES, SCREENS, TOOLS, listTeams, type Team } from './lib/tables';
import { gadgets, widgets } from './lib/widgets';
import { WidgetRoutes } from './routes/WidgetRoutes';

/** A link to each screen kept under its address. */
export function Nav() {
  return (
    <nav>
      {Object.entries(SCREENS).map(([path]) => (
        <Link key={path} to={path}>
          {path}
        </Link>
      ))}
    </nav>
  );
}

/** Every screen of the console. */
export default function App() {
  // Each page under the slug it is kept under: the key of each pair read in the step.
  const pages = Object.entries(PAGES).map(([slug, page]) => ({ ...page, path: `/pages/${slug}` }));
  // Each team gathered under its slug, then the slug of each pair.
  const teams = Object.entries(listTeams().reduce((all, team) => ({ ...all, [team.slug]: team }), {} as Record<string, Team>)).map(([slug, team]) => ({
    path: `/teams/${slug}`,
    Screen: team.Screen,
  }));
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        {Object.entries(SCREENS).map(([path, Screen]) => (
          <Route key={path} path={path} element={<Screen />} />
        ))}
        {Object.entries(TOOLS).map(([path, { Screen }]) => (
          <Route key={path} path={path} element={<Screen />} />
        ))}
        {pages.map((page) => (
          <Route key={page.path} path={page.path} element={<page.Screen />} />
        ))}
        {teams.map((team) => (
          <Route key={team.path} path={team.path} element={<team.Screen />} />
        ))}
        {makeShelf()
          .routes()
          .map((shelf) => (
            <Route key={shelf.path} path={shelf.path} element={<shelf.Screen />} />
          ))}
        {makeBin()
          .routes()
          .map((bin) => (
            <Route key={bin.path} path={bin.path} element={<bin.Screen />} />
          ))}
        {getDock()
          .routes()
          .map((dock) => (
            <Route key={dock.path} path={dock.path} element={<dock.Screen />} />
          ))}
      </Routes>
      <WidgetRoutes registry={widgets} />
      <WidgetRoutes registry={gadgets} />
    </BrowserRouter>
  );
}
