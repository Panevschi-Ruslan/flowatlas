import Koa from 'koa';
import Router from '@koa/router';
import { hostHooks } from 'plugin-host';
import { Hook, PluginManager } from '../utils/PluginManager';
import documents from './documents.routes';

/**
 * The API application: one router, and three ways something is mounted on it.
 *
 * The first is the registry, written once for however many plugins registered a
 * router. The second is an ordinary import, which has always been read. The
 * third is a registry published by a package, whose members are contributed in
 * code that is not in this repository at all.
 */
const api = new Koa();
const router = new Router();

// Registered before the others, as the real one is, so that a plugin may
// override a route the application declares.
PluginManager.getHooks(Hook.API).forEach((hook) => router.use('/', hook.value.routes()));

router.use('/', documents.routes());

hostHooks('api').forEach((hook) => router.use('/', hook.value.routes()));

api.use(router.routes());
api.use(router.allowedMethods());

export default api;
