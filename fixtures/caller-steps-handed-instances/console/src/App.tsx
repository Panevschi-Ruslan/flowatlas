import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import './features/alerts';
import './features/stats';
import './features/usage';
import { InvoicesEdit } from './features/screens';
import { listAreas, listBoards, listGuides, listLogs, listReports, listTasks, listTeams, toLogRoute, type Entry } from './lib/lists';
import { panels } from './lib/panels';

/** Every screen of the console, one route per entry of each view. */
export default function App() {
  // Each area flat-mapped to one object over it.
  const areas = listAreas().flatMap((area) => ({ ...area, path: `/areas${area.path}` }));
  // Each report flat-mapped to two objects over it.
  const reports = listReports().flatMap((report) => [
    { ...report, path: `/reports${report.path}` },
    { ...report, path: `/reports${report.path}/edit`, Screen: InvoicesEdit },
  ]);
  // Array.from with a function mapping each board.
  const boards = Array.from(listBoards(), (board) => ({ ...board, path: `/boards${board.path}` }));
  // A reduce spreading what it has gathered and adding an object over each team.
  const teams = listTeams().reduce<Entry[]>((all, team) => [...all, { ...team, path: `/teams${team.path}` }], []);
  // A reduce pushing an object over each task onto what it gathers.
  const tasks = listTasks().reduce((all, task) => {
    all.push({ ...task, path: `/tasks${task.path}` });
    return all;
  }, [] as Entry[]);
  // A flatMap keeping a guide as it is or leaving it out: a filter.
  const guides = listGuides().flatMap((guide) => (guide.path === '' ? [] : [guide]));
  // A reduce adding what a function of its own builds: not read.
  const logs = listLogs().reduce((all, log) => all.concat(toLogRoute(log)), [] as Entry[]);
  return (
    <BrowserRouter>
      <nav>
        <Link to="/areas/billing">Billing</Link>
        <Link to="/panels/usage">Usage</Link>
        <Link to="/logs/audit">Audit</Link>
      </nav>
      <Routes>
        {areas.map((area) => (
          <Route key={area.path} path={area.path} element={<area.Screen />} />
        ))}
        {reports.map((report) => (
          <Route key={report.path} path={report.path} element={<report.Screen />} />
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
        {panels.routes().map((panel) => (
          <Route key={panel.path} path={panel.path} element={<panel.Screen />} />
        ))}
      </Routes>
    </BrowserRouter>
  );
}
