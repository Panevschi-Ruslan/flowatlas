/** Types for `virtual-list.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

export interface VirtualListOptions {
  /** How many rows there are. */
  count: number;
  /** Each row's height in pixels: one for every row, or one per row. */
  rowHeight: number | ((i: number) => number);
  /** Builds row i's <li>; the list places, sizes and numbers it. */
  render: (i: number) => HTMLElement;
  /** A row drawn wherever the window is (the one picked), or null. */
  keep?: () => number | null;
  /** Rows drawn past each edge of the window. */
  overscan?: number;
  /** The list's height while it has none. */
  fallback?: number;
}

export interface VirtualList {
  /** Every row drawn anew, `count` of them (the same number when omitted). */
  update(count?: number): void;
  /** Row i scrolled into the window and drawn. */
  scrollTo(i: number): void;
  /** The <li> of row i, scrolled into the window first when it was not drawn. */
  rowEl(i: number): HTMLElement | null;
  /** The rows in the document, by position. */
  drawn(): number[];
  size(): number;
}

export declare function createVirtualList(page?: Page): Panel<'virtualList'> & {
  virtualList: (el: HTMLElement, options: VirtualListOptions) => VirtualList;
};
