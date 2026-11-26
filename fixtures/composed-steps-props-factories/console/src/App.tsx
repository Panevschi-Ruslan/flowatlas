import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './features/install';
import { AreaEdit } from './features/screens';
import { desks } from './lib/desks';
import { GUIDES, LOGS, listAreas, listBoards, listTasks, listTeams, type Entry } from './lib/lists';
import { menu } from './lib/menu';
import { panels } from './lib/panels';
import { shelves } from './lib/shelves';
import { PanelRoutes, ShelfRoutes } from './routes/PanelRoutes';

/** Every screen of the console, one route per entry of each view. */
export default function App() {
  // A map, then a flatMap over what it made: each area, and a page to edit it.
  const areas = listAreas()
    .map((area) => ({ ...area, path: `/areas${area.path}` }))
    .flatMap((area) => [area, { ...area, path: `${area.path}/edit`, Screen: AreaEdit }]);
  // A map over a map.
  const boards = listBoards()
    .map((board) => ({ ...board, path: `/boards${board.path}` }))
    .map((board) => ({ ...board, path: `${board.path}/view` }));
  // A reduce gathering each team under its path into an object, then its values.
  const teams = Object.values(listTeams().reduce((all, team) => ({ ...all, [team.path]: { ...team, path: `/teams${team.path}` } }), {} as Record<string, Entry>));
  // A reduce writing each task under its path, then its [key, entry] pairs mapped.
  const tasks = Object.entries(
    listTasks().reduce(
      (all, task) => {
        all[task.path] = { ...task, path: `/tasks${task.path}` };
        return all;
      },
      {} as Record<string, Entry>,
    ),
  ).map(([, task]) => ({ ...task, path: `${task.path}/board` }));
  // The values of an object written in place.
  const guides = Object.values(GUIDES);
  // Pairs read without being taken apart: not read.
  const logs = Object.entries(LOGS).map((pair) => ({ path: pair[1].path, Screen: pair[1].Screen }));
  return (
    <BrowserRouter>
      <Routes>
        {areas.map((area) => (
          <Route key={area.path} path={area.path} element={<area.Screen />} />
        ))}
        {boards.map((board) => (
          <Route key={board.path} path={board.path} element={<board.Screen />} />
        ))}
        {teams.map((team) => (
          <Route key={team.path} path={team.path} element={<team.Screen />} />
        ))}
        {tasks.map((task) => (
          <Route key={task.path} path={task.path} element={<task.Screen />} />
        ))}
        {guides.map((guide) => (
          <Route key={guide.path} path={guide.path} element={<guide.Screen />} />
        ))}
        {logs.map((log) => (
          <Route key={log.path} path={log.path} element={<log.Screen />} />
        ))}
        {menu.list().map((entry) => (
          <Route key={entry.path} path={entry.path} element={<entry.Screen />} />
        ))}
        {desks.list().map((desk) => (
          <Route key={desk.path} path={desk.path} element={<desk.Screen />} />
        ))}
      </Routes>
      <PanelRoutes registry={panels} />
      <ShelfRoutes shelf={shelves} />
    </BrowserRouter>
  );
}
