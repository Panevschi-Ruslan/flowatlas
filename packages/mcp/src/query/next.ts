/**
 * The call an assistant makes next, given the id it now holds.
 *
 * Every row a tool returns carries an `id` another tool takes as it is; these
 * hints say which. The Strategy keyed by node type lives in core's prompt
 * renderer (P97), since a copied prompt ends with the same calls the server
 * suggests; this module names it the way the tools always have.
 */
import { PROMPT_MAX_NEXT, promptHintsFor, promptNextFor } from '@flowatlas/core';

export interface Identified {
  id: string;
  type: string;
}

/** How many hints one answer carries: enough to show the chain, no more. */
export const MAX_NEXT: number = PROMPT_MAX_NEXT;

/** The calls that take this node's id, in the order they are usually useful. */
export const hintsFor = (node: Identified | undefined): string[] => promptHintsFor(node);

/** Hints for several nodes, first come first, without repeats, bounded. */
export const nextFor = (...nodes: Array<Identified | undefined>): string[] => promptNextFor(...nodes);

/** Adds `next` to an answer when there is something to say. */
export const withNext = <T extends object>(answer: T, next: readonly string[]): T & { next?: string[] } =>
  next.length === 0 ? answer : { ...answer, next: [...next] };
