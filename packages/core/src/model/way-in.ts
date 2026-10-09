import type { GraphNode } from './nodes.js';

/**
 * The key of an entry's `meta` that names the channel the entry hands what it
 * receives to itself, when that is the whole of what it does: a route a
 * platform puts straight onto a queue or a bus, with no code behind it by
 * design. Its work is the message it sends, drawn as a publisher the entry
 * calls (R173).
 */
export const SENDS_META = 'sends';

/**
 * Whether the code behind one way in was read.
 *
 * One definition for every reader of a graph that asks it, because three do and
 * they disagreed: `doctor` decides on it, `build` prints it, and the coverage
 * harness reports it. The harness used to count a `handles` edge as a body read,
 * so a service whose routes were built by a helper - `export const GET =
 * handler(config)` - read as having every body attached while `doctor` refused
 * the same graph for having almost none. Two answers to one question, which is
 * the defect R115, R118 and R125 each closed once already.
 *
 * Two conditions, and the second is why the first is not enough. A `handles`
 * edge is the graph's own answer to "what runs when this is called", whichever
 * adapter drew it. But an adapter that named a handler it could not follow says
 * so on the node - `handlerBodyRead: false` - and the edge onto that handler is
 * real, pointing at the call the framework enters, so the edge alone would count
 * a way in nobody read as read.
 *
 * A way in that has no code behind it by design is read when the message it
 * sends is (`SENDS_META`): that message is everything that happens after the
 * request arrives, and counting it as a way in without a handler would size a
 * gap that is not there (R173).
 */
export const wayInBodyRead = (entry: GraphNode, handled: (id: string) => boolean): boolean =>
  typeof entry.meta?.[SENDS_META] === 'string' || (handled(entry.id) && entry.meta?.['handlerBodyRead'] !== false);
