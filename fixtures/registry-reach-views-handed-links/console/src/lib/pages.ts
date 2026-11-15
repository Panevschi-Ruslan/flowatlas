import type { ComponentType } from 'react';

/** One page of the console: its address and its screen. */
export interface Page {
  readonly path: string;
  readonly Screen: ComponentType;
}

/** Every page, by its address: a store this module keeps and other modules add to. */
export const pages = new Map<string, Page>();

/** The pages in the order they were added. */
export function listPages(): Page[] {
  return [...pages.values()];
}
