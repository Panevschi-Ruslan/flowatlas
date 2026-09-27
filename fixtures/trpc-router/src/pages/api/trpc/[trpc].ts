import { createNextApiHandler } from '../../../server/next-adapter';
import { appRouter } from '../../../server/root';

export default createNextApiHandler(appRouter);
