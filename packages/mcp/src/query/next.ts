/**
 * The call an assistant makes next, given the id it now holds.
 *
 * Every row a tool returns carries an `id` another tool takes as it is; these
 * hints say which. A Strategy keyed by node type, so a new type of node is one
 * entry here and nothing in the tools.
 */

export interface Identified {
  id: string;
  type: string;
}

/** How many hints one answer carries: enough to show the chain, no more. */
export const MAX_NEXT = 4;

type Hints = (id: string) => string[];

const q = (id: string): string => JSON.stringify(id);

const SYMBOL: Hints = (id) => [
  `who_calls({symbol: ${q(id)}})`,
  `impact({symbol: ${q(id)}})`,
  `get_source({symbol: ${q(id)}})`,
];

const NONE: Hints = () => [];

const BY_TYPE: ReadonlyMap<string, Hints> = new Map<string, Hints>([
  ['entry', (id) => [`get_flow({entry: ${q(id)}})`, `describe_for_prompt({id: ${q(id)}})`, `impact({symbol: ${q(id)}})`]],
  ['channel', (id) => [`who_emits({channel: ${q(id)}})`, `who_consumes({channel: ${q(id)}})`, `describe_for_prompt({id: ${q(id)}})`]],
  ['table', (id) => [`impact({symbol: ${q(id)}})`, `who_calls({symbol: ${q(id)}})`]],
  ['type', (id) => [`get_type({type: ${q(id)}})`]],
  ['missing', NONE],
  ['ref', NONE],
]);

/** A type id is a type whatever the row calls it. */
const typeOf = (node: Identified): string => (node.id.startsWith('type:') ? 'type' : node.type);

/** The calls that take this node's id, in the order they are usually useful. */
export const hintsFor = (node: Identified | undefined): string[] =>
  node === undefined ? [] : (BY_TYPE.get(typeOf(node)) ?? SYMBOL)(node.id);

/** Hints for several nodes, first come first, without repeats, bounded. */
export const nextFor = (...nodes: Array<Identified | undefined>): string[] => {
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const hint of hintsFor(node)) {
      if (seen.size >= MAX_NEXT) return [...seen];
      seen.add(hint);
    }
  }
  return [...seen];
};

/** Adds `next` to an answer when there is something to say. */
export const withNext = <T extends object>(answer: T, next: readonly string[]): T & { next?: string[] } =>
  next.length === 0 ? answer : { ...answer, next: [...next] };
