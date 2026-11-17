import type { ComponentType } from 'react';
import { Audit, Backlog, Billing, Guides, Invoices, Kanban, Members } from '../features/screens';

/** One entry of a list the console's routes are built from. */
export interface Entry {
  readonly path: string;
  readonly Screen: ComponentType;
}

const AREAS: Entry[] = [{ path: '/billing', Screen: Billing }];
const REPORTS: Entry[] = [{ path: '/invoices', Screen: Invoices }];
const BOARDS: Entry[] = [{ path: '/kanban', Screen: Kanban }];
const TEAMS: Entry[] = [{ path: '/members', Screen: Members }];
const TASKS: Entry[] = [{ path: '/backlog', Screen: Backlog }];
const LOGS: Entry[] = [{ path: '/audit', Screen: Audit }];
const GUIDES: Entry[] = [{ path: '/guides', Screen: Guides }];

export function listAreas(): Entry[] {
  return AREAS;
}

export function listReports(): Entry[] {
  return REPORTS;
}

export function listBoards(): Entry[] {
  return BOARDS;
}

export function listTeams(): Entry[] {
  return TEAMS;
}

export function listTasks(): Entry[] {
  return TASKS;
}

export function listLogs(): Entry[] {
  return LOGS;
}

export function listGuides(): Entry[] {
  return GUIDES;
}

/** A log's route, built by a function of its own. */
export function toLogRoute(log: Entry): Entry {
  return { path: `/logs${log.path}`, Screen: log.Screen };
}
