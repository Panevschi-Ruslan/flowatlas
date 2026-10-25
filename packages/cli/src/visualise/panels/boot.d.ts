/** Types for `boot.js`; see page.d.ts. */
import type { PackedGraph } from '../pack.js';
import type { Page } from './page.js';

/** The panels in the order the page sets them up. */
export declare const PANELS: readonly ((page: Page) => Record<string, unknown>)[];
export declare function bootPage(data: PackedGraph): Page;
