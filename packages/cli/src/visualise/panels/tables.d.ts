/** Types for `tables.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

/** `CROSSINGS_CHUNK`: how many Crossings rows are built at a time (P102); the first chunk at once, the rest when idle. */
export declare function createTables(page: Page): Panel<
  'CROSSINGS_CHUNK' | 'ambiguousHtml' | 'appendUnmatched' | 'drawBusiest' | 'drawChanges' | 'drawCrossings' | 'unmatchedHtml'
>;
