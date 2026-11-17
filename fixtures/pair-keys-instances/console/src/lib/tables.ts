import type { ComponentType } from 'react';
import { Export, Faq, Inbox, Intro, Members, Reports } from '../features/screens';

/** One entry of a list the console's routes are built from. */
export interface Entry {
  readonly path: string;
  readonly Screen: ComponentType;
}

/** Screens kept under the address each is shown at. */
export const SCREENS: Record<string, ComponentType> = {
  '/reports': Reports,
  '/inbox': Inbox,
};

/** Tools kept under their address, each an object naming its screen. */
export const TOOLS: Record<string, { readonly Screen: ComponentType }> = {
  '/tools/export': { Screen: Export },
};

/** Pages kept under a slug each. */
export const PAGES: Record<string, { readonly Screen: ComponentType }> = {
  intro: { Screen: Intro },
  faq: { Screen: Faq },
};

/** A team, with the slug it is shown under. */
export interface Team {
  readonly slug: string;
  readonly Screen: ComponentType;
}

const TEAMS: Team[] = [{ slug: 'members', Screen: Members }];

export function listTeams(): Team[] {
  return TEAMS;
}
