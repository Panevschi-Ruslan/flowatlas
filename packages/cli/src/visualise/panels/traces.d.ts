/** Types for `traces.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

/** The Traces tab (sampled requests on their own time axis) and the Run time changes tab (P111). */
export declare function createTraces(page: Page): Panel<'drawRunChanges' | 'drawTraces'>;
