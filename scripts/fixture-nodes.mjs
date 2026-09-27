/**
 * Finds a fixture's nodes by what they are, so that no test has to spell out
 * where they are written.
 *
 * A node id carries the line and the column the thing was written at, which is
 * deliberate: identity by place is what lets two builds of the same source
 * agree, and it is not going to change. The trouble was never the ids, it was
 * that twenty-eight assertions had typed one out. Adding two `import type`
 * lines to a fixture moved every request below them, and twenty-two
 * expectations went red without a single behaviour having changed. Reproducing
 * a defect in a fixture before fixing it is the operation this project relies
 * on most, and it had become the expensive one.
 *
 * So an assertion names the thing — the client method that makes the request,
 * the component method a click hands control to — and asks here for the
 * coordinate. The fixture can then gain or lose a line freely: the snapshots
 * move, they are regenerated, and no test moves at all.
 *
 * A resolver that quietly returned the first of several matches would be worse
 * than the coordinates it replaced, because the assertion would still pass
 * while being about something else. So every answer here is exactly one node,
 * and anything else throws with the candidates named.
 */

import { readFileSync } from 'node:fs';

/**
 * How a node is reached from the thing an assertion names, one row per way.
 *
 * A table rather than a run of branches, so that teaching the resolver a new
 * way of naming a node is adding a row and nothing else. `subjectAt` says
 * which end of the edge the named symbol sits on, and the node being looked
 * for is at the other one.
 *
 * The names read from the node's side, which is the side the assertion is
 * about: the request `calledBy` a client method, the cache operation
 * `cachedBy` a service method, the click `handling` a component method.
 */
const RELATIONS = {
  /** A request, a query or an emit, hung off the method whose body writes it. */
  calledBy: { edge: 'calls', subjectAt: 'from' },
  /** A read or a write on a cache, hung off the method whose body writes it. */
  cachedBy: { edge: 'caches', subjectAt: 'from' },
  /** A click or a submit in a template, pointing at the method it reaches. */
  handling: { edge: 'handles', subjectAt: 'to' },
};

const OTHER_END = { from: 'to', to: 'from' };

export const RELATION_NAMES = Object.keys(RELATIONS);

/** Reads a project or repository graph written by a build. */
export const readGraphFile = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * The one node a selector describes.
 *
 * A selector is a node type and exactly one relation, e.g.
 * `{ type: 'http_out', calledBy: 'gateway#src/clients/orders.client.ts:OrdersClient.fetchOne' }`,
 * which reads as "the request that method makes".
 */
export const resolveNode = (graph, selector) => {
  if (selector === null || typeof selector !== 'object') {
    throw new TypeError('a selector is an object naming a node type and one relation');
  }
  const { type, ...rest } = selector;
  if (typeof type !== 'string' || type === '') {
    throw new TypeError(`a selector names a node type; got ${JSON.stringify(type)}`);
  }
  const keys = Object.keys(rest);
  const unknown = keys.filter((key) => !Object.hasOwn(RELATIONS, key));
  if (unknown.length > 0) {
    throw new TypeError(
      `a selector knows no relation named ${unknown.join(', ')}; ` +
        `the ones it knows are ${RELATION_NAMES.join(', ')}`,
    );
  }
  if (keys.length !== 1) {
    throw new TypeError(
      `a selector carries exactly one of ${RELATION_NAMES.join(', ')}, and this one carries ${keys.length}`,
    );
  }

  const relation = keys[0];
  const subject = rest[relation];
  const where = `${type} ${relation} ${subject}`;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  if (!byId.has(subject)) {
    throw new Error(
      `no node ${where}: this graph has no node ${subject} to start from. ` +
        'The symbol was probably renamed or moved to another file.',
    );
  }

  const { edge: edgeType, subjectAt } = RELATIONS[relation];
  const reached = graph.edges
    .filter((edge) => edge.type === edgeType && edge[subjectAt] === subject)
    .map((edge) => byId.get(edge[OTHER_END[subjectAt]]))
    .filter((node) => node !== undefined);
  const found = reached.filter((node) => node.type === type);

  if (found.length === 1) return found[0];

  if (found.length === 0) {
    const instead =
      reached.length === 0
        ? 'it reaches nothing of any type'
        : `it reaches ${reached.map((node) => `${node.type} (${node.id})`).join(', ')}`;
    throw new Error(`no node ${where}: ${instead}`);
  }

  throw new Error(
    `${found.length} nodes ${where}: ${found.map((node) => node.id).join(', ')}. ` +
      'Name one of them some other way; answering with the first would make the ' +
      'assertion pass about whichever one happened to come back first.',
  );
};

/** The id of the one node a selector describes. */
export const resolveNodeId = (graph, selector) => resolveNode(graph, selector).id;
