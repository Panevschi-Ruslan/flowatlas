import type { AdapterRegistry, EntryAdapter } from '@flowatlas/core';
import { configuredProceduresAdapter } from './configured-procedures.js';
import { configuredRoutesAdapter } from './configured-routes.js';
import { deployedFunctionsAdapter } from './deployed-functions.js';
import { entryRegistriesAdapter } from './entry-registries.js';
import {
  expressRoutesAdapter,
  fastifyRoutesAdapter,
  honoRoutesAdapter,
  koaRoutesAdapter,
} from './call-routes.js';
import { nestjsHttpAdapter } from './nestjs-http.js';
import { medusaRoutesAdapter } from './medusa-routes.js';
import { nextjsRoutesAdapter } from './nextjs-routes.js';
import { trpcProceduresAdapter } from './procedure-routers.js';
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
  nextjsRoutesAdapter,
  medusaRoutesAdapter,
  honoRoutesAdapter,
  expressRoutesAdapter,
  fastifyRoutesAdapter,
  koaRoutesAdapter,
  nestjsMicroserviceAdapter,
  nestjsScheduleAdapter,
  nestjsTelegrafAdapter,
  telegrafCallsAdapter,
  trpcProceduresAdapter,
  entryRegistriesAdapter,
  configuredRoutesAdapter,
  configuredProceduresAdapter,
  deployedFunctionsAdapter,
];

export const registerEntryAdapters = (registry: AdapterRegistry): AdapterRegistry =>
  registry.registerAll('entry', entryAdapters);

export { CONFIGURED_ROUTES, configuredRoutesAdapter } from './configured-routes.js';
export {
  DEPLOYED_FUNCTIONS,
  DEPLOYMENT_READERS,
  LAMBDA_PACKAGES,
  deployedFunctionsAdapter,
  deploymentReadersFor,
} from './deployed-functions.js';
export { deployedSourceDirectories } from './deployed-sources.js';
export {
  CONFIGURED_PROCEDURES,
  configuredProceduresAdapter,
} from './configured-procedures.js';
export type { ProcedureDialect, ProcedureMount } from './procedure-dialects.js';
export { PROCEDURE_DIALECTS, TRPC, procedureDialectOf } from './procedure-dialects.js';
export type { ProcedureRoutersOptions } from './procedure-routers.js';
export { procedureRoutersAdapter, trpcProceduresAdapter } from './procedure-routers.js';
export {
  callRoutesAdapter,
  expressRoutesAdapter,
  fastifyRoutesAdapter,
  koaRoutesAdapter,
} from './call-routes.js';
export type { CallRoutesOptions } from './call-routes.js';
export type {
  AppType,
  MiddlewareShape,
  MountShape,
  RouteDialect,
  RouteObjectShape,
} from './route-dialects.js';
export { dialectOf, EXPRESS, FASTIFY, HONO, KOA, ROUTE_DIALECTS } from './route-dialects.js';
export type { ActionBuilder } from './action-builders.js';
export { ACTION_BUILDERS, NEXT_SAFE_ACTION, ZSA } from './action-builders.js';
export { APP_PAGES, APP_ROUTER, PAGES_API } from './nextjs-paths.js';
export {
  fsAddressSpace,
  fsApplicationMap,
  pathPatternTest,
  readVerbFile,
  routePathOfFile,
  verbReading,
} from './fs-routes.js';
export type {
  FsAddress,
  FsAddressSpace,
  FsRouter,
  FsRouteVerb,
  SegmentConvention,
  VerbReading,
} from './fs-routes.js';
export { MEDUSA_API } from './medusa-routes.js';
export {
  entryRegistriesAdapter,
  honoRoutesAdapter,
  medusaRoutesAdapter,
  nestjsHttpAdapter,
  nestjsMicroserviceAdapter,
  nestjsScheduleAdapter,
  nestjsTelegrafAdapter,
  nextjsRoutesAdapter,
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
  builtExportFunction,
  builtExportFunctions,
  enclosingClass,
  enclosingHandler,
  handlerInside,
  handlerOfFunction,
  handlerReturned,
  joinPath,
  repoClasses,
  repoFunctionOf,
  repoSources,
  unwrapValue,
} from './shared.js';
