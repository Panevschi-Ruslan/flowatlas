/** Types for `map-ui.js`; see page.d.ts. */
import type { Page, Panel } from './page.js';

/**
 * The Map tab. `mapListHtml(map, view)` is the tab on a phone (P102): a card
 * per box of `view` (as `mapView` gives it), under the call-order column it
 * would be drawn in.
 */
export declare function createMapUi(page: Page): Panel<'mapController' | 'mapListHtml' | 'setMapFull'>;
