import Koa from 'koa';

import { adminRouter } from './admin.routes';

/** An application mounted through a helper nobody described. */
export const admin = new Koa();

admin.use(adminRouter.routes());
