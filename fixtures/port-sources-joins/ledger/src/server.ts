import Router from '@koa/router';
import Koa from 'koa';
import type { Context } from 'koa';

import { config } from './config';

const app = new Koa();
const router = new Router();

router.get('/entries', async (ctx: Context) => {
  ctx.body = [];
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(config.get('port'));
