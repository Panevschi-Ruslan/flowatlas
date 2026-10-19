/** Types for `graph-ui.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

export declare function createGraphUi(page: Page): Panel<
  'closeDetails' | 'closePopovers' | 'draw' | 'go' | 'graph' | 'hashNow' | 'select' | 'setPopover' | 'syncControls' |
  'writeHash'
>;
