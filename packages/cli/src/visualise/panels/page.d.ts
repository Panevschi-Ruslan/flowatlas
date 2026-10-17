/**
 * Types for the page's panels (P103), which stay plain JavaScript because the
 * page runs their text as it is. Only the tests read these. Each panel's own
 * `.d.ts` names what it returns, and `panels.test.ts` holds it to that.
 */
import type { GraphModel } from '../graph.js';
import type { PackedGraph } from '../pack.js';

/** What the store holds, by key. */
export interface PageState {
  /** The way in picked on the left, by node position. */
  current: number | null;
  /** The tab open: map, steps, crossings, missing, busiest, changes or graph; null until the first is shown. */
  view: string | null;
  /** The services the rail lets through, by name: one Set, changed in place and set again. */
  shown: Set<string>;
}

/** The little state the tabs share. `on` hears every `set` and returns how to stop. */
export interface PageStore {
  get<Key extends keyof PageState>(key: Key): PageState[Key];
  set<Key extends keyof PageState>(key: Key, value: PageState[Key]): void;
  on(listener: <Key extends keyof PageState>(key: Key, value: PageState[Key]) => void): () => void;
}

/**
 * The page as a panel is handed it: the context, then whatever the panels set
 * up before it returned, all by name.
 */
export interface Page {
  data: PackedGraph;
  model: GraphModel;
  store: PageStore;
  nodes: PackedGraph['nodes'];
  [name: string]: any;
}

/** What a panel returns: the names it gives the panels after it. */
export type Panel<Name extends string> = { [Key in Name]: any };
