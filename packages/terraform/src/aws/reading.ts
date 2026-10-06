import type { DeployedDelivery, Unresolved } from '@flowatlas/core';
import type { Instance } from '../eval/values.js';

/**
 * What a reader of one resource type is handed: where to put what it found,
 * and the two questions about the rest of the deployment it may need to ask.
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
}

/**
 * One row of the table of resource types a deployment is read through: the
 * type, and what reading one instance of it adds.
 */
export type ResourceReader = readonly [type: string, read: (instance: Instance, reading: ResourceReading) => void];
