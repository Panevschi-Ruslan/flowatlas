/** Types for `frame-ui.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

export declare function createFrameUi(page: Page): Panel<
  'PICTURE_PAD' | 'PICTURE_STYLES' | 'copyTypes' | 'fullScreen' | 'notice' | 'openEverything' | 'refocus' |
  'reopen' | 'root' | 'save' | 'toggleType' | 'typing'
>;
