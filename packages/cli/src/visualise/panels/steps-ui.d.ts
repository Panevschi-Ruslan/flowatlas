/** Types for `steps-ui.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

export declare function createStepsUi(page: Page): Panel<
  'drawSteps' | 'setStepMode' | 'stepMode' | 'stepRowHtml' | 'stepsInGraph' | 'stepsView' | 'waterfallHtml'
>;
