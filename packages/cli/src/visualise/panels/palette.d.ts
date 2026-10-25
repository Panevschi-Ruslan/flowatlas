/** Types for `palette.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

/** A command of the command list: what it says, when it is offered, and what it does. */
export interface PaletteAction {
  id: string;
  say: string | (() => string);
  when?: () => boolean;
  run: () => void;
}

export declare function createPalette(page: Page): Panel<
  'PALETTE_ACTIONS' | 'closePalette' | 'menuKeys' | 'openKeys' | 'openPalette'
>;
