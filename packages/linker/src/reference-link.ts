import {
  CONFIDENCE_LEVELS,
  CONFIDENCE_RANK,
  entryReferenceOf,
  REACHED_AS_META,
  REACHES_META,
  RESULT_OF_META,
  type ReachedAs,
  type Confidence,
  type GraphEdge,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import { cmp, edgeKey } from './order.js';

/**
 * Joins a node to an entry it names by a deployed name alone.
 *
 * A step that starts another workflow knows the name that workflow is deployed
 * under and nothing else - not the repository it is written in, not whether it
 * is in this project at all. So the step records a reference (`workflow:returns`,
 * the entry's kind and key with no service) under `meta.reaches`, and this is
 * where the reference meets the one entry whose id ends in it, in whichever
 * service declares it: the same join a publisher and a consumer make on a
 * channel's name, made for an entry.
 *
 * The node may say how it reaches a reference (`meta.reachedAs`): a run's
 * outcome handed on is a `triggers` edge, and an outcome or an IoT rule's error
 * action carries `meta.when` (P60). A node that a function created elsewhere
 * hands its run on into names that function the other way round
 * (`meta.resultOf`), and the edge runs from the function's entry into it.
 *
 * A reference that names no entry, or names entries in two services, is a row
 * and no edge. Two services declaring one deployed name is a conflict to report,
 * not a tie to break.
 */

/** What an entry of each kind is called in a sentence. Anything else is "the <kind> entry". */
const NOUNS: ReadonlyMap<string, string> = new Map([
  ['workflow', 'the workflow'],
  ['invoke', 'the function'],
]);

const describe = (reference: string): string => {
  const cut = reference.indexOf(':');
  const kind = reference.slice(0, cut);
  return `${NOUNS.get(kind) ?? `the ${kind} entry`} ${reference.slice(cut + 1)}`;
};

const isConfidence = (value: unknown): value is Confidence =>
  typeof value === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(value);

/**
 * How far a join on an entry's name can be trusted.
 *
 * `static` unless the entry says its own name is less certain than that - a
 * name taken from a file name rather than from what deploys it - or the caller
 * says the name it holds is, in which case a join on the name is no stronger
 * than the weaker of the two.
 */
const confidenceOf = (caller: GraphNode, target: GraphNode): Confidence => {
  const named = target.meta?.['nameConfidence'];
  // What the caller says of its own name - read from code it could only
  // recognise by the source, or taken from a table somebody wrote (P24).
  const stated = caller.meta?.['confidence'];
  // `static` is the strongest there is, so the weakest of the three wins.
  return [named, stated].filter(isConfidence).reduce<Confidence>((weakest, each) => (CONFIDENCE_RANK[each] < CONFIDENCE_RANK[weakest] ? each : weakest), 'static');
};

/** One reference a node holds, and the edge it becomes once the entry it names is found. */
interface Join {
  readonly node: GraphNode;
  readonly reference: string;
  readonly edge: (target: GraphNode) => GraphEdge;
}

const siteOf = (node: GraphNode): Pick<GraphEdge, 'file' | 'line'> => ({
  ...(node.file === undefined ? {} : { file: node.file }),
  ...(node.line === undefined ? {} : { line: node.line }),
});

const whenMeta = (when: unknown): Record<string, unknown> => (when === undefined ? {} : { when });

/** Every reference a node reaches, each to an edge out of it. */
const reachesOf = (caller: GraphNode): Join[] => {
  const listed = caller.meta?.[REACHES_META];
  if (!Array.isArray(listed)) return [];
  const shapes = (caller.meta?.[REACHED_AS_META] as Record<string, ReachedAs> | undefined) ?? {};
  return listed
    .filter((reference): reference is string => typeof reference === 'string' && reference.includes(':'))
    .map((reference) => ({
      node: caller,
      reference,
      edge: (target) => ({
        from: caller.id,
        to: target.id,
        type: shapes[reference]?.type ?? 'calls',
        confidence: confidenceOf(caller, target),
        ...siteOf(caller),
        meta: { via: 'deployed-name', reference, ...whenMeta(shapes[reference]?.when) },
      }),
    }));
};

/** The function a node is handed the run of, as an edge from that function's entry into it. */
const resultOf = (node: GraphNode): Join[] => {
  const reference = node.meta?.[RESULT_OF_META];
  if (typeof reference !== 'string' || !reference.includes(':')) return [];
  return [
    {
      node,
      reference,
      edge: (target) => ({
        from: target.id,
        to: node.id,
        type: 'triggers',
        confidence: confidenceOf(node, target),
        ...siteOf(node),
        meta: { via: 'deployed-name', reference, ...whenMeta(node.meta?.['when']) },
      }),
    },
  ];
};

export const joinReferences = (
  nodes: ReadonlyMap<string, GraphNode>,
  edges: Map<string, GraphEdge>,
): Unresolved[] => {
  const entries = new Map<string, GraphNode[]>();
  for (const node of nodes.values()) {
    if (node.type !== 'entry') continue;
    const reference = entryReferenceOf(node.id);
    if (reference === undefined) continue;
    entries.set(reference, [...(entries.get(reference) ?? []), node]);
  }

  const findings: Unresolved[] = [];
  const joins = [...nodes.values()].sort((a, b) => cmp(a.id, b.id)).flatMap((node) => [...reachesOf(node), ...resultOf(node)]);
  for (const { node: caller, reference, edge: edgeTo } of joins) {
    const targets = (entries.get(reference) ?? []).sort((a, b) => cmp(a.id, b.id));
    if (targets.length === 1) {
      const edge = edgeTo(targets[0] as GraphNode);
      if (!edges.has(edgeKey(edge))) edges.set(edgeKey(edge), edge);
      continue;
    }
    findings.push(
      targets.length === 0
        ? {
            service: caller.repo,
            file: caller.file ?? '',
            line: caller.line ?? 0,
            reason: 'reference-not-found',
            message: `${caller.label} reaches ${describe(reference)}, which no configured service declares`,
            hint: 'Add the repository that deploys it to the configuration, so this step reaches its code.',
            symbol: caller.id,
            meta: { reference },
          }
        : {
            service: caller.repo,
            file: caller.file ?? '',
            line: caller.line ?? 0,
            reason: 'reference-ambiguous',
            message: `${caller.label} reaches ${describe(reference)}, which ${targets.map((target) => target.repo).join(' and ')} all declare`,
            hint: 'A deployed name belongs to one thing. One of the declarations is stale, or two environments are configured as one project.',
            symbol: caller.id,
            meta: { reference, candidates: targets.map((target) => target.id) },
          },
    );
  }
  return findings;
};
