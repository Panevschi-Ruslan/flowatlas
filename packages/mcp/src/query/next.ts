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

/** What an answer already says of a row (P364): whether it runs, and where it is reached from. */
export interface RowShown {
  id?: string;
  label?: string;
  reach?: string;
  from?: string;
}

const CALL = /^(\w+)\(\{(\w+): ("(?:[^"\\]|\\.)*")/;

/** The tool a hint calls and the first value it hands, or nothing for a hint written another way. */
const calledWith = (hint: string): { tool: string; key: string; value: string } | undefined => {
  const found = CALL.exec(hint);
  if (found === null) return undefined;
  try {
    return { tool: found[1]!, key: found[2]!, value: JSON.parse(found[3]!) as string };
  } catch {
    return undefined;
  }
};

/**
 * `next` without the calls that would only repeat what the rows say (P364):
 * `dead` on a row that shows its `reach`, and `who_calls` or `search` for a
 * row that shows where it is reached `from`. A call that pages, or walks on
 * from where a walk was cut, adds rows, and is passed apart by the caller.
 */
export const withoutShown = (next: readonly string[], rows: readonly RowShown[]): string[] => {
  const reached = new Set<string>();
  const placed = new Set<string>();
  for (const row of rows) {
    if (row.id === undefined) continue;
    if (row.reach !== undefined) reached.add(row.id);
    if (row.from === undefined) continue;
    placed.add(row.id);
    if (row.label === undefined) continue;
    placed.add(row.label);
    // A method's label is `Class.method`: a search for its class asks the same.
    const dot = row.label.indexOf('.');
    if (dot > 0) placed.add(row.label.slice(0, dot));
  }
  return next.filter((hint) => {
    const call = calledWith(hint);
    if (call === undefined) return true;
    if (call.tool === 'dead' && call.key === 'id') return !reached.has(call.value);
    if ((call.tool === 'who_calls' && call.key === 'symbol') || (call.tool === 'search' && call.key === 'query')) return !placed.has(call.value);
    return true;
  });
};
