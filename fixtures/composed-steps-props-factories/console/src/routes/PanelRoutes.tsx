import { Route, Routes } from 'react-router-dom';
import type { PanelRegistry } from '../lib/panels';
import type { ShelfRegistry } from '../lib/shelves';

/** The routes of the registry it is handed, taken out of its props. */
export function PanelRoutes({ registry }: { registry: PanelRegistry }) {
  return (
    <Routes>
      {registry.routes().map((panel) => (
        <Route key={panel.path} path={panel.path} element={<panel.Screen />} />
      ))}
    </Routes>
  );
}

/** The routes of the shelves it is handed, read off its props. */
export function ShelfRoutes(props: { shelf: ShelfRegistry }) {
  return (
    <Routes>
      {props.shelf.routes().map((shelf) => (
        <Route key={shelf.path} path={shelf.path} element={<shelf.Screen />} />
      ))}
    </Routes>
  );
}
