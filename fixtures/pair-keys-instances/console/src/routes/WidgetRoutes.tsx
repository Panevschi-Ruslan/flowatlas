import { Route, Routes } from 'react-router-dom';
import type { WidgetRegistry } from '../lib/widgets';

/** The routes of the registry it is handed: the console's widgets at one use, its gadgets at another. */
export function WidgetRoutes({ registry }: { registry: WidgetRegistry }) {
  return (
    <Routes>
      {registry.routes().map((widget) => (
        <Route key={widget.path} path={widget.path} element={<widget.Screen />} />
      ))}
    </Routes>
  );
}
