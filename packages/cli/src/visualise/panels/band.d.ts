/** Types for `band.js`; see page.d.ts. */
import type { GraphModel } from '../graph.js';
import type { PackedGraph } from '../pack.js';
import type { Page, Panel } from './page.js';

/** One thing Start here offers (P98): what it is, what it names, a few words more, and the link that opens it. */
export interface StartPick {
  what: string;
  say: string;
  note: string;
  href: string;
}

/** The Start here card: drawn on asking, hidden, or offered on a first visit unless it was closed before. */
export interface StartCard {
  show(): void;
  hide(): void;
  offer(): void;
}

export declare function createBand(page: Page): Panel<'startCard' | 'startHere'> & {
  startCard: StartCard;
  startHere: (model: GraphModel, data: PackedGraph) => StartPick[];
};
