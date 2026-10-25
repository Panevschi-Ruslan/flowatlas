/** Types for `wiring.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

export declare function wirePage(page: Page): Panel<'showView' | 'start'>;
