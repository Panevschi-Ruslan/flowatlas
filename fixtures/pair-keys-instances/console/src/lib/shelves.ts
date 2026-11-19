import { DockMain, Hidden, ShelfHome } from '../features/screens';
import type { Entry } from './tables';

/** Shelves, every one starting with the home shelf. */
export class ShelfRegistry {
  items: Entry[] = [{ path: '/shelf/home', Screen: ShelfHome }];

  add(entry: Entry): void {
    this.items.push(entry);
  }

  routes(): Entry[] {
    return this.items;
  }
}

/** A factory making a registry afresh at each call. */
export const makeShelf = (): ShelfRegistry => new ShelfRegistry();

/** Another instance the factory makes, added to: not the one read in place. */
export const other = makeShelf();
other.add({ path: '/shelf/other', Screen: Hidden });

/** Bins, which start empty. */
export class BinRegistry {
  items: Entry[] = [];

  add(entry: Entry): void {
    this.items.push(entry);
  }

  routes(): Entry[] {
    return this.items;
  }
}

export const makeBin = (): BinRegistry => new BinRegistry();

/** The one dock, made the first time it is asked for. */
export class DockRegistry {
  items: Entry[] = [];

  add(entry: Entry): void {
    this.items.push(entry);
  }

  routes(): Entry[] {
    return this.items;
  }
}

let dock: DockRegistry | undefined;

export function getDock(): DockRegistry {
  return (dock ??= new DockRegistry());
}

getDock().add({ path: '/dock/main', Screen: DockMain });
