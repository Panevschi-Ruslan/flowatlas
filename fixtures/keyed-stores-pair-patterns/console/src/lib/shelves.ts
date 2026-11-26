import { ShelfPage } from '../features/screens';
import type { Entry } from './tables';

/** A shelf of pages, kept in an instance's field. */
export class Shelf {
  items: Entry[] = [];

  add(entry: Entry): void {
    this.items.push(entry);
  }

  routes(): Entry[] {
    return this.items;
  }
}

/** Thirteen shelves, each with one page. */
export const shelf01 = new Shelf();
export const shelf02 = new Shelf();
export const shelf03 = new Shelf();
export const shelf04 = new Shelf();
export const shelf05 = new Shelf();
export const shelf06 = new Shelf();
export const shelf07 = new Shelf();
export const shelf08 = new Shelf();
export const shelf09 = new Shelf();
export const shelf10 = new Shelf();
export const shelf11 = new Shelf();
export const shelf12 = new Shelf();
export const shelf13 = new Shelf();

shelf01.add({ path: '/shelves/01', Screen: ShelfPage });
shelf02.add({ path: '/shelves/02', Screen: ShelfPage });
shelf03.add({ path: '/shelves/03', Screen: ShelfPage });
shelf04.add({ path: '/shelves/04', Screen: ShelfPage });
shelf05.add({ path: '/shelves/05', Screen: ShelfPage });
shelf06.add({ path: '/shelves/06', Screen: ShelfPage });
shelf07.add({ path: '/shelves/07', Screen: ShelfPage });
shelf08.add({ path: '/shelves/08', Screen: ShelfPage });
shelf09.add({ path: '/shelves/09', Screen: ShelfPage });
shelf10.add({ path: '/shelves/10', Screen: ShelfPage });
shelf11.add({ path: '/shelves/11', Screen: ShelfPage });
shelf12.add({ path: '/shelves/12', Screen: ShelfPage });
shelf13.add({ path: '/shelves/13', Screen: ShelfPage });
