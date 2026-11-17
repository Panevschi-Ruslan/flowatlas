import { FrontDesk } from '../features/screens';
import type { Entry } from './lists';

/** A factory handing back an object written in place, its store a field of the object. */
export function makeDesks() {
  return {
    items: [] as Entry[],
    add(entry: Entry) {
      this.items.push(entry);
    },
    /** Each desk under the desks, gathered under its path into an object, then its values. */
    list(): Entry[] {
      return Object.values(this.items.reduce((all, desk) => ({ ...all, [desk.path]: { ...desk, path: `/desks${desk.path}` } }), {} as Record<string, Entry>));
    },
  };
}

/** The console's desks. */
export const desks = makeDesks();
desks.add({ path: '/front', Screen: FrontDesk });
