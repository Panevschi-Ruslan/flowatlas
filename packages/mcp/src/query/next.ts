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

/**
 * `next` with `trace_for({entry})` after its first hint (P105), when the
 * observed file holds a sample of that entry: a request that ran, step by
 * step, is the next thing worth reading after its flow. Bounded as every
 * `next` is.
 */
export const withTraceFor = (
  next: readonly string[],
  entry: Identified | undefined,
  sampled: (id: string) => boolean,
): string[] => {
  if (entry === undefined || entry.type !== 'entry' || !sampled(entry.id)) return [...next];
  const hint = `trace_for({entry: ${JSON.stringify(entry.id)}})`;
  return [...new Set([...next.slice(0, 1), hint, ...next.slice(1)])].slice(0, MAX_NEXT);
};
