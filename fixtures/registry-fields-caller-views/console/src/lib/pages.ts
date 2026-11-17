import type { ComponentType } from 'react';
import { Drafts, Home } from '../features/screens';

/** One page: its address, whether it is shown, and its screen. */
export interface Page {
  readonly path: string;
  readonly enabled: boolean;
  readonly Screen: ComponentType;
}

const PAGES: Page[] = [
  { path: '/home', enabled: true, Screen: Home },
  { path: '/drafts', enabled: true, Screen: Drafts },
];

/** The pages, as written. */
export function listPages(): Page[] {
  return PAGES;
}
