import type { AdapterRegistry, EntryAdapter } from '@flowatlas/core';
import { entryRegistriesAdapter } from './entry-registries.js';
import {
  expressRoutesAdapter,
  fastifyRoutesAdapter,
  honoRoutesAdapter,
  koaRoutesAdapter,
} from './call-routes.js';
import { nestjsHttpAdapter } from './nestjs-http.js';
import { nestjsMicroserviceAdapter } from './nestjs-microservice.js';
import { nestjsScheduleAdapter } from './nestjs-schedule.js';
import { nestjsTelegrafAdapter } from './nestjs-telegraf/index.js';
import { telegrafCallsAdapter } from './telegraf-calls.js';

export const PACKAGE_NAME = '@flowatlas/adapters-entry';

/**
 * Every entry-point adapter this package provides.
 *
 * Order is registration order, which is also the order detection reports them
 * in. A later phase adds more to this list; nothing else has to change.
 */
export const entryAdapters: readonly EntryAdapter[] = [
  nestjsHttpAdapter,
  honoRoutesAdapter,
  expressRoutesAdapter,
  fastifyRoutesAdapter,
  koaRoutesAdapter,
  nestjsMicroserviceAdapter,
  nestjsScheduleAdapter,
  nestjsTelegrafAdapter,
  telegrafCallsAdapter,
  entryRegistriesAdapter,
];

export const registerEntryAdapters = (registry: AdapterRegistry): AdapterRegistry =>
  registry.registerAll('entry', entryAdapters);

export {
  callRoutesAdapter,
  expressRoutesAdapter,
  fastifyRoutesAdapter,
  koaRoutesAdapter,
} from './call-routes.js';
export type {
  AppType,
  MiddlewareShape,
  MountShape,
  RouteDialect,
  RouteObjectShape,
} from './route-dialects.js';
export { EXPRESS, FASTIFY, HONO, KOA, ROUTE_DIALECTS } from './route-dialects.js';
export {
  entryRegistriesAdapter,
  honoRoutesAdapter,
  nestjsHttpAdapter,
  nestjsMicroserviceAdapter,
  nestjsScheduleAdapter,
  nestjsTelegrafAdapter,
  telegrafCallsAdapter,
};
export {
  BOT_DECORATORS,
  BOT_KINDS,
  deriveKey,
  entryMeta,
  isTelegrafDecorator,
  readBotClass,
  resolveTriggerArg,
  stepTrigger,
  TELEGRAF_MODULE,
  telegrafDecoratorName,
  wizardChain,
} from './nestjs-telegraf/index.js';
export type {
  BotClass,
  BotDecorator,
  BotEntryMeta,
  BotTrigger,
  CallbackData,
  ChainLink,
  StepSite,
  TriggerArg,
  WizardChain,
} from './nestjs-telegraf/index.js';
export {
  enclosingClass,
  enclosingHandler,
  handlerInside,
  handlerOfFunction,
  handlerReturned,
  joinPath,
  repoClasses,
  repoFunctionOf,
  repoSources,
} from './shared.js';
