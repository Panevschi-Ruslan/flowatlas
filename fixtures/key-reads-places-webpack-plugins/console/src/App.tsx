import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { catalog, shelfRoutes } from './lib/catalog';
import { AREAS, FLOW, LATE, LINKS, PAGES, SECTIONS, SHORTCUTS, STAGES, STEPS, TOOLS, tourSteps } from './lib/tables';

/** Every screen of the console. */
export default function App() {
  return (
    <BrowserRouter>
      <nav>
        {/* A link written straight over the keys: each key the address. */}
        {Object.keys(SHORTCUTS).map((to) => (
          <Link key={to} to={to}>
            {SHORTCUTS[to]}
          </Link>
        ))}
      </nav>
      <Routes>
        {/* Routes written straight over the keys, each element looked up by its key. */}
        {Object.keys(PAGES).map((path) => (
          <Route key={path} path={path} element={PAGES[path]} />
        ))}
        {Object.keys(TOOLS).map((name) => (
          <Route key={name} path={`/tools/${name}`} element={TOOLS[name]} />
        ))}
        {/* A pattern nested two keys into the pair's entry, and one key into a list's item. */}
        {Object.entries(AREAS).map(([slug, { meta: { view: { Screen } } }]) => (
          <Route key={slug} path={`/areas/${slug}`} element={<Screen />} />
        ))}
        {Object.entries(SECTIONS).map(([slug, { meta: { Screen } }]) => (
          <Route key={slug} path={'/sections/' + slug} element={<Screen />} />
        ))}
        {LINKS.map(({ to, view: { Screen } }) => (
          <Route key={to} path={to} element={<Screen />} />
        ))}
        {/* Lists read as [place, item] pairs. */}
        {Object.entries(STEPS).map(([step, { Screen }]) => (
          <Route key={step} path={`/wizard/${step}`} element={<Screen />} />
        ))}
        {Object.entries(STAGES).map(([stage, { Screen }]) => (
          <Route key={stage} path={`/stages/${stage}`} element={<Screen />} />
        ))}
        {Object.entries(FLOW).map(([at, { Screen }]) => (
          <Route key={at} path={`/flow/${at}`} element={<Screen />} />
        ))}
        {Object.entries(tourSteps()).map(([at, { Screen }]) => (
          <Route key={at} path={`/tour/${at}`} element={<Screen />} />
        ))}
        {Object.entries(LATE).map(([at, { Screen }]) => (
          <Route key={at} path={`/late/${at}`} element={<Screen />} />
        ))}
        {/* Objects an adding function writes from what each call hands, under the key the call hands. */}
        {catalog.routes().map((page) => (
          <Route key={page.path} path={page.path} element={<page.Screen />} />
        ))}
        {shelfRoutes().map((shelf) => (
          <Route key={shelf.path} path={shelf.path} element={<shelf.Screen />} />
        ))}
      </Routes>
    </BrowserRouter>
  );
}
