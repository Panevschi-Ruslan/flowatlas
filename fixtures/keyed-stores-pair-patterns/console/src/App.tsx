import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { areaBook, book, panels, toolbox } from './lib/books';
import {
  shelf01,
  shelf02,
  shelf03,
  shelf04,
  shelf05,
  shelf06,
  shelf07,
  shelf08,
  shelf09,
  shelf10,
  shelf11,
  shelf12,
  shelf13,
} from './lib/shelves';
import { AREAS, EXTRA_A, EXTRA_B, EXTRA_C, EXTRA_D, LINKS, SECTIONS, WIZARD } from './lib/tables';
import { ShelfRoutes } from './routes/ShelfRoutes';

/** Every screen of the console. */
export default function App() {
  // Each pair's entry taken apart by an object pattern, `base` its default where the entry writes none.
  const sections = Object.entries(SECTIONS).map(([slug, { Screen, base = '/docs' }]) => ({ path: `${base}/${slug}`, element: <Screen /> }));
  // A pattern nested in the entry's pattern.
  const areas = Object.entries(AREAS).map(([slug, { meta: { Screen } }]) => ({ path: `/areas/${slug}`, Screen }));
  // A list's item taken apart.
  const links = LINKS.map(({ to, Screen }) => ({ path: to, Screen }));
  // A list read as pairs: each item under its place.
  const wizard = Object.entries(WIZARD).map(([step, Screen]) => ({ path: `/wizard/${step}`, Screen }));
  return (
    <BrowserRouter>
      <Routes>
        {sections.map((section) => (
          <Route key={section.path} path={section.path} element={section.element} />
        ))}
        {areas.map((area) => (
          <Route key={area.path} path={area.path} element={<area.Screen />} />
        ))}
        {links.map((link) => (
          <Route key={link.path} path={link.path} element={<link.Screen />} />
        ))}
        {wizard.map((step) => (
          <Route key={step.path} path={step.path} element={<step.Screen />} />
        ))}
        {book.routes().map((page) => (
          <Route key={page.path} path={page.path} element={<page.Screen />} />
        ))}
        {panels.routes().map((panel) => (
          <Route key={panel.path} path={panel.path} element={<panel.Screen />} />
        ))}
        {toolbox.routes().map((tool) => (
          <Route key={tool.path} path={tool.path} element={<tool.Screen />} />
        ))}
        {areaBook.routesOf('admin').map((area) => (
          <Route key={area.path} path={area.path} element={<area.Screen />} />
        ))}
        {EXTRA_A.map((extra) => (
          <Route key={extra.path} path={extra.path} element={<extra.Screen />} />
        ))}
        {EXTRA_B.map((extra) => (
          <Route key={extra.path} path={extra.path} element={<extra.Screen />} />
        ))}
        {EXTRA_C.map((extra) => (
          <Route key={extra.path} path={extra.path} element={<extra.Screen />} />
        ))}
        {EXTRA_D.map((extra) => (
          <Route key={extra.path} path={extra.path} element={<extra.Screen />} />
        ))}
      </Routes>
      <ShelfRoutes shelf={shelf01} />
      <ShelfRoutes shelf={shelf02} />
      <ShelfRoutes shelf={shelf03} />
      <ShelfRoutes shelf={shelf04} />
      <ShelfRoutes shelf={shelf05} />
      <ShelfRoutes shelf={shelf06} />
      <ShelfRoutes shelf={shelf07} />
      <ShelfRoutes shelf={shelf08} />
      <ShelfRoutes shelf={shelf09} />
      <ShelfRoutes shelf={shelf10} />
      <ShelfRoutes shelf={shelf11} />
      <ShelfRoutes shelf={shelf12} />
      <ShelfRoutes shelf={shelf13} />
    </BrowserRouter>
  );
}
