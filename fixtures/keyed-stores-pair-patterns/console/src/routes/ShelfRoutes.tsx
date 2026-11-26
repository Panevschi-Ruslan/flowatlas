import { Route, Routes } from 'react-router-dom';
import type { Shelf } from '../lib/shelves';

/** The routes of the shelf it is handed: each of thirteen at one use each. */
export function ShelfRoutes({ shelf }: { shelf: Shelf }) {
  return (
    <Routes>
      {shelf.routes().map((item) => (
        <Route key={item.path} path={item.path} element={<item.Screen />} />
      ))}
    </Routes>
  );
}
