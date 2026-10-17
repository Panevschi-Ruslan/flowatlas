/** Types for `tables.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

export declare function createTables(page: Page): Panel<
  'ambiguousHtml' | 'appendUnmatched' | 'drawBusiest' | 'drawChanges' | 'drawCrossings' | 'unmatchedHtml'
>;
