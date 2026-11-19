import { AtlasPrint } from '../features/screens';
import type { Entry } from './lists';

/** The shelves added, kept in an instance's field. */
export class ShelfRegistry {
  items: Entry[] = [];

  add(entry: Entry): void {
    this.items.push(entry);
  }

  /** Each shelf under the shelves, then each beside a page to print it: one step over another. */
  routes(): Entry[] {
    return this.items
      .map((shelf) => ({ ...shelf, path: `/shelves${shelf.path}` }))
      .flatMap((shelf) => [shelf, { ...shelf, path: `${shelf.path}/print`, Screen: AtlasPrint }]);
  }
}

/** A factory making a registry afresh at each call. */
export const makeShelves = (): ShelfRegistry => new ShelfRegistry();

/** The console's shelves. */
export const shelves = makeShelves();

/** Shelves nobody shows: another instance the same factory makes. */
export const archive = makeShelves();
