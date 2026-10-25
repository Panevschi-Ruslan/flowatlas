import { ENVIRONMENT_META, type EnvironmentValue, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { reachedBy } from './environment-link.js';
import { cmp } from './order.js';

/**
 * The function URLs a request rooted at a setting reaches (P54).
 *
 * A function behind a URL of its own is an `http` entry answering every verb
 * and every path, and the address is handed to whoever calls it the way a
 * queue's is: as a value of the environment a function is deployed with,
 * `CARD_LOOKUP_URL = aws_lambda_function_url.card_lookup.function_url`. No
 * service claims that setting as its base, so the call is joined through the
 * functions that run it instead: each one deployed with the setting naming a
 * function's URL sends the request there.
 */

/** A function's URL entry, by the function's deployed name. */
const urlEntriesOf = (nodes: ReadonlyMap<string, GraphNode>): Map<string, GraphNode> => {
  const byFunction = new Map<string, GraphNode>();
  for (const node of nodes.values()) {
    if (node.type !== 'entry' || node.meta?.['by'] !== 'function-url') continue;
    const fn = node.meta?.['function'];
    if (typeof fn === 'string' && !byFunction.has(fn)) byFunction.set(fn, node);
  }
  return byFunction;
};

/**
 * For every request rooted at a setting, the URL entries the functions running
 * it name by that setting, sorted; a request reaching none is absent.
 */
export const functionUrlsOf = (nodes: ReadonlyMap<string, GraphNode>, edges: ReadonlyMap<string, GraphEdge>): Map<string, GraphNode[]> => {
  const out = new Map<string, GraphNode[]>();
  const urls = urlEntriesOf(nodes);
  if (urls.size === 0) return out;
  const functions = [...nodes.values()]
    .filter((node) => node.type === 'entry' && node.meta?.[ENVIRONMENT_META] !== undefined)
    .sort((a, b) => cmp(a.id, b.id));
  const reached = reachedBy(nodes, edges, functions);
  for (const [id, runners] of reached) {
    const env = nodes.get(id)?.meta?.['baseUrlEnv'];
    if (nodes.get(id)?.type !== 'http_out' || typeof env !== 'string') continue;
    const entries = new Map<string, GraphNode>();
    for (const fn of runners) {
      const value = (fn.meta?.[ENVIRONMENT_META] as Record<string, EnvironmentValue>)[env];
      const entry = value?.kind === 'url' && value.value !== undefined ? urls.get(value.value) : undefined;
      if (entry !== undefined) entries.set(entry.id, entry);
    }
    if (entries.size > 0) out.set(id, [...entries.values()].sort((a, b) => cmp(a.id, b.id)));
  }
  return out;
};
