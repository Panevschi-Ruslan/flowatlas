/** Types for `menu.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

/** An item of a row's `⋯` menu (P100), by the row's position in `data.rows`. */
export interface RowMenuItem {
  id: string;
  say: string;
  /** Offered for this row; every row when absent. */
  when?: (r: number) => boolean;
  /** A second line under the words: where it applies. */
  sub?: (r: number) => string;
  /** A line under the items to read first, '' for none. */
  warn?: (r: number) => string;
  /** What is copied. */
  text: (r: number) => string | null;
  /** The text is a command for the shell: shown in the toast, and said under the items. */
  command?: boolean;
  /** What the toast says for text that is not a command. */
  copied?: string;
}

export declare function createMenu(page: Page): Panel<'ROW_MENU_ITEMS' | 'closeMenu' | 'openMenu' | 'promptMenu' | 'rowMenu' | 'toast'>;
