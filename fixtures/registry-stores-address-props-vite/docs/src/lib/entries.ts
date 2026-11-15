import type { ComponentType } from 'react';

/** One entry of a list a caller keeps: the group it is in, its address and its screen. */
export interface Entry {
  readonly group: string;
  readonly path: string;
  readonly Screen: ComponentType;
}

/** Adds an entry to the list it is handed. */
export function addEntry(store: Entry[], entry: Entry): void {
  store.push(entry);
}

/** The entries of one group in the list it is handed. */
export function entriesIn(store: Entry[], group: string): Entry[] {
  return store.filter((entry) => entry.group === group);
}
