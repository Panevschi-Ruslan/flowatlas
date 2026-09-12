import type { ClassDeclaration, MethodDeclaration } from 'ts-morph';
import type { EntryKind, GraphNode } from '@flowatlas/core';
import type { WrapperRef, WrappingLayer } from '../bootstrap.js';

/** Where a wrapper was attached, which is also how specific it is. */
export type WrappingScope = 'global' | 'class' | 'method' | 'route';

export interface WrapperApplication {
  layer: WrappingLayer;
  scope: WrappingScope;
  wrapper: WrapperRef;
  /** How it was registered, e.g. the decorator name or the bootstrap call. */
  source: string;
  /** Class it was attached to, for class-scoped applications. */
  owner?: ClassDeclaration;
  /** Method it was attached to, for method-scoped applications. */
  method?: MethodDeclaration;
  /** Route filter, for middleware. */
  routes?: MiddlewareRoutes;
  file: string;
}

/** What `forRoutes` and `exclude` were given. */
export interface MiddlewareRoutes {
  include: MiddlewareRoute[];
  exclude: MiddlewareRoute[];
  /** True when a route argument could not be read statically. */
  dynamic: boolean;
}

export interface MiddlewareRoute {
  /** Normalised path, or undefined when the route names a controller instead. */
  path?: string;
  /** Restricts the route to one HTTP method. */
  method?: string;
  controller?: ClassDeclaration;
}

export interface EntryRecord {
  node: GraphNode;
  kind: EntryKind;
  /** Full path including any global prefix, for HTTP entries. */
  path?: string;
  /** Path as written on the controller, without the global prefix. */
  routePath?: string;
  httpMethod?: string;
  handlerClass?: ClassDeclaration;
  handlerMethod?: MethodDeclaration;
}

export interface WrappingCollection {
  /** Applied to every entry, in the order they take effect. */
  globals: WrapperApplication[];
  /** Attached to a controller class. */
  byClass: Map<ClassDeclaration, WrapperApplication[]>;
  /** Attached to a single handler. */
  byMethod: Map<MethodDeclaration, WrapperApplication[]>;
  /** Middleware, with the routes each one covers. */
  middleware: WrapperApplication[];
}

export const emptyCollection = (): WrappingCollection => ({
  globals: [],
  byClass: new Map(),
  byMethod: new Map(),
  middleware: [],
});
