import { createNextApiHandler } from '../../../../server/next-adapter';
import { reportsRouterFor } from '../../../../server/reports-factory';

export default createNextApiHandler(reportsRouterFor('daily'));
