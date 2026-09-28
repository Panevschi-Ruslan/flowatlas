import { saveOrder } from '../../../lib/orders-store';
import { serveJob } from '../../../lib/serve-job';

/**
 * A verb taken out of the object a library handed back.
 *
 * `POST` is declared by a binding element rather than by a declaration of its
 * own, so a reader asking what this module declares finds a variable whose name
 * is a pattern and no function anywhere. The way in was read from where the
 * file is, as always; what this fixture holds the tool to is that the work
 * written inside the call is what answers it, so the flow carries on into the
 * data layer instead of stopping at the boundary (R74).
 */
export const { POST } = serveJob(async (request) => {
  await saveOrder(await request.json());
});
