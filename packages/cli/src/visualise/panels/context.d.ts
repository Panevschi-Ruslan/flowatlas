/** Types for `context.js`; see page.d.ts. */
import type { PackedGraph } from '../pack.js';
import type { Page, PageState, PageStore } from './page.js';

export declare function createStore(initial: PageState): PageStore;
export declare function createPageContext(data: PackedGraph): Page;
