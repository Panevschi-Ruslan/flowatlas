import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { catalog } from './lib/catalog';
import { panels, steps, tourRoutes, widgetRoutes } from './lib/registries';

/** The late tour's module, loaded on demand. */
export const loadLateTour = () => import('./features/tour-late');

/** Every screen of the console. */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* A registry's list, read as [place, step] pairs: the places the modules adding to it are evaluated in. */}
        {steps.routes().map((page) => (
          <Route key={page.path} path={page.path} element={<page.Screen />} />
        ))}
        {/* A module's list pushed onto by other modules, read as [place, panel] pairs. */}
        {Object.entries(panels).map(([at, { Screen }]) => (
          <Route key={at} path={`/panels/${at}`} element={<Screen />} />
        ))}
        {/* One adding module reached through a dynamic import, and one list added to under two entry points: rows. */}
        {tourRoutes().map((page) => (
          <Route key={page.path} path={page.path} element={<page.Screen />} />
        ))}
        {widgetRoutes().map((page) => (
          <Route key={page.path} path={page.path} element={<page.Screen />} />
        ))}
        {/* Objects an adding function writes, reached through adding functions handing on their own parameters. */}
        {catalog.routes().map((page) => (
          <Route key={page.path} path={page.path} element={<page.Screen />} />
        ))}
      </Routes>
    </BrowserRouter>
  );
}
