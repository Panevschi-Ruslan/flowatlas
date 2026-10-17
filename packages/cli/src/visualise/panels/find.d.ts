/** Types for `find.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

export declare function createFind(page: Page): Panel<'focusFind' | 'goToFound' | 'markFound'>;
