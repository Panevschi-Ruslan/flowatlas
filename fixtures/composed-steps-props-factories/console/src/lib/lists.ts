import type { ComponentType } from 'react';
import { Audit, Backlog, Billing, Kanban, Members, Start } from '../features/screens';

/** One entry of a list the console's routes are built from. */
export interface Entry {
  readonly path: string;
  readonly Screen: ComponentType;
}

const AREAS: Entry[] = [{ path: '/billing', Screen: Billing }];
const BOARDS: Entry[] = [{ path: '/kanban', Screen: Kanban }];
const TEAMS: Entry[] = [{ path: '/members', Screen: Members }];
const TASKS: Entry[] = [{ path: '/backlog', Screen: Backlog }];

/** The guides, kept under a key each. */
export const GUIDES: Record<string, Entry> = {
  start: { path: '/guides/start', Screen: Start },
};

/** The logs, kept under a key each. */
export const LOGS: Record<string, Entry> = {
  audit: { path: '/logs/audit', Screen: Audit },
};

export function listAreas(): Entry[] {
  return AREAS;
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
