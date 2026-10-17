/** Types for `checking.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

export declare function createChecking(page: Page): Panel<
  'askImpact' | 'askPath' | 'asked' | 'badgesHtml' | 'checkActionsHtml' | 'chooseEnd' | 'dismissAnswer' |
  'drawAnswer' | 'stopPicking'
>;
