import type { ComponentType } from 'react';

/** One page on the shelf. */
export interface ShelfPage {
  readonly path: string;
  readonly Screen: ComponentType;
}

/** A class that only keeps a store, in a static field. */
export class Shelf {
  static entries = new Map<string, ShelfPage>();
}

/** The pages on the shelf, read off the class's field by a function of its own. */
export function shelfPages(): ShelfPage[] {
  return [...Shelf.entries.values()];
}
