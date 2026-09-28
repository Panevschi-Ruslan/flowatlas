import Router from '@koa/router';
import { Hook, PluginManager } from '../../../utils/PluginManager';

/**
 * A second plugin, registering one router with the singular spelling.
 *
 * `add({ … })` rather than `add([{ … }])`: both are ordinary, and a reader that
 * only opened lists would find one of the two plugins.
 */
const router = new Router();

router.post('webhooks.create', async (ctx) => {
  ctx.body = { data: {} };
});

PluginManager.add({ name: 'webhooks', type: Hook.API, value: router });
