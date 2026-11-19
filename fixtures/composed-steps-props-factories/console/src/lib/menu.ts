import { Hidden, MenuHome } from '../features/screens';
import type { Entry } from './lists';

/** A factory handing back an object written in place, its store a variable it keeps for the object's functions. */
export function makeMenu() {
  const items: Entry[] = [];
  return {
    add(entry: Entry) {
      items.push(entry);
    },
    list() {
      return items.map((entry) => ({ ...entry, path: `/menu${entry.path}` }));
    },
  };
}

/** The console's menu. */
export const menu = makeMenu();
menu.add({ path: '/home', Screen: MenuHome });

/** A menu nobody shows: another object the same factory makes. */
export const spare = makeMenu();
spare.add({ path: '/spare', Screen: Hidden });
