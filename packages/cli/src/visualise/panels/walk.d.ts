/** Types for `walk.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

export declare function createWalk(page: Page): Panel<'capSel' | 'depthSel' | 'drawWalk' | 'titleEl' | 'walkEl'>;
