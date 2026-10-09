import type { DeployedDelivery, RouteTarget, Unresolved } from '@flowatlas/core';
import type { Because, Instance } from '../eval/values.js';
import type { Integration } from './integrations.js';

/** Where a route's path was found to start, as far as it was read. */
export type RoutePath =
  /** A full path, under the API that declares it when that is known. */
  | { readonly kind: 'path'; readonly path: string; readonly api?: Instance }
  /** Below a point of an API another deployment publishes (P21). */
  | { readonly kind: 'root'; readonly key: string; readonly below: string }
  | { readonly kind: 'unknown'; readonly because: Because };

/** An authoriser in front of a route, by what the deployment calls it. */
export interface RouteGuard {
  readonly label: string;
  readonly file: string;
  readonly line: number;
}

/** One route as a reader of one way of declaring routes found it. */
export interface RouteDraft {
  /** What declares it, for a person and for every row about it: unique per deployment. */
  readonly address: string;
  /** The block it is read from, which rows name. */
  readonly symbol: string;
  readonly file: string;
  readonly line: number;
  readonly method: string;
  readonly path: RoutePath;
  readonly rawPath: string;
  readonly target: RouteTarget | Because | undefined;
  /** The API it belongs to, when the path does not already say. */
  readonly api?: Instance;
  readonly guards: readonly RouteGuard[];
}

/**
 * What a reader of one resource type is handed: where to put what it found,
 * and the questions about the rest of the deployment it may need to ask.
 *
 * Narrower than the reading itself on purpose. A reader of rules or of
 * subscriptions knows nothing about routes or roots, and a reader written
 * against this can be tested with a reading of nothing but what it reads.
 */
export interface ResourceReading {
  readonly rows: Unresolved[];
  readonly deliveries: DeployedDelivery[];
  /** Every instance of one type, managed or looked up. */
  ofType(mode: 'managed' | 'data', type: string): readonly Instance[];
  /** The position among the deployment's functions of one it creates. */
  functionIndex(instance: Instance): number | undefined;
  /**
   * The function an integration invokes: one this deployment creates, or one
   * by its deployed name; why not, when it names one that is not read.
   */
  invoked(integration: Integration): RouteTarget | Because | undefined;
  /** A route, at every address its API is reached at (R174). */
  route(draft: RouteDraft): void;
}

/**
 * One row of the table of resource types a deployment is read through: the
 * type, and what reading one instance of it adds.
 */
export type ResourceReader = readonly [type: string, read: (instance: Instance, reading: ResourceReading) => void];
