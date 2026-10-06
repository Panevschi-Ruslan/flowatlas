import {
  CONFIDENCE_LEVELS,
  entryReferenceOf,
  REACHES_META,
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
 * name taken from a file name rather than from what deploys it - in which case
 * a join on the name is no stronger than the name.
 */
const confidenceOf = (target: GraphNode): Confidence => {
  const named = target.meta?.['nameConfidence'];
  // `static` is the strongest there is, so the weaker of the two is the name's.
  return isConfidence(named) ? named : 'static';
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
  const callers = [...nodes.values()]
    .filter((node) => Array.isArray(node.meta?.[REACHES_META]))
    .sort((a, b) => cmp(a.id, b.id));
  for (const caller of callers) {
    const references = (caller.meta?.[REACHES_META] as unknown[]).filter(
      (reference): reference is string => typeof reference === 'string' && reference.includes(':'),
    );
    for (const reference of references) {
      const targets = (entries.get(reference) ?? []).sort((a, b) => cmp(a.id, b.id));
      if (targets.length === 1) {
        const target = targets[0] as GraphNode;
        const edge: GraphEdge = {
          from: caller.id,
          to: target.id,
          type: 'calls',
          confidence: confidenceOf(target),
          ...(caller.file === undefined ? {} : { file: caller.file }),
          ...(caller.line === undefined ? {} : { line: caller.line }),
          meta: { via: 'deployed-name', reference },
        };
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
  }
  return findings;
};
