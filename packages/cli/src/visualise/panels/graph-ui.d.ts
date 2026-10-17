/** Types for `graph-ui.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

export declare function createGraphUi(page: Page): Panel<
  'closeDetails' | 'closeResults' | 'draw' | 'go' | 'graph' | 'hashNow' | 'resultsEl' | 'select' | 'syncControls' |
  'writeHash'
>;
