import { createPageContext } from './context.js';
import { createBand } from './band.js';
import { createWays } from './ways.js';
import { createWalk } from './walk.js';
import { createTables } from './tables.js';
import { createFind } from './find.js';
import { createMissing } from './missing.js';
import { createGraphDraw } from './graph-draw.js';
import { createDetails } from './details.js';
import { createChecking } from './checking.js';
import { createGraphUi } from './graph-ui.js';
import { createFrameUi } from './frame-ui.js';
import { createMapUi } from './map-ui.js';
import { createStepsUi } from './steps-ui.js';
import { createPalette } from './palette.js';
import { wirePage } from './wiring.js';

/* The panels, in the order the page sets them up. Each is handed the page's
   context with what the panels before it returned merged in; what it returns
   is merged in for the panels after it. A panel that needs one set up after
   it reads it through `page` when it runs (`page.showView(...)`), never while
   it is being set up. The order is the one the page always had: it decides
   which listener on a shared element hears an event first. */
export const PANELS = [
  createBand, createWays, createWalk, createTables, createFind, createMissing, createGraphDraw, createDetails,
  createChecking, createGraphUi, createFrameUi, createMapUi, createStepsUi, createPalette, wirePage,
];

/* The page from its packed graph: every panel set up, then the first view. */
export function bootPage(data) {
  const page = createPageContext(data);
  for (const create of PANELS) {
    for (const [name, value] of Object.entries(create(page))) {
      if (name in page) throw new Error(`two parts of the page both give ${name}`);
      page[name] = value;
    }
  }
  page.start();
  return page;
}
