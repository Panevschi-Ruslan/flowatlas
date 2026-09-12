/**
 * What counts as "the same node" and "a different node".
 *
 * An id already carries the repository, the file and the symbol, so a rename is
 * honestly a removal and an addition. What is left for a fingerprint to decide
 * is whether a node that kept its id still says the same thing — and the one
 * thing it must not notice is the line it sits on, because inserting an import
 * moves every symbol in the file without changing any of them.
 */
import type { GraphEdge, GraphNode } from '@flowatlas/core';

/** JSON with object keys in a fixed order, so two equal values read alike. */
export const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
};

/**
 * Meta with the position stripped out.
 *
 * `line` is the only key with a fixed meaning across node types, and it is the
 * one that moves without anything changing. Everything else a pass wrote is
 * part of what the node says.
 */
const metaWithoutPosition = (meta: Record<string, unknown> | undefined): Record<string, unknown> => {
  if (meta === undefined) return {};
  const { line: _line, ...rest } = meta;
  return rest;
};

/** The fields of a node that make it what it is, position excluded. */
const nodeShape = (node: GraphNode): Record<string, unknown> => ({
  type: node.type,
  label: node.label,
  kind: node.kind ?? null,
  repo: node.repo,
  file: node.file ?? null,
  meta: metaWithoutPosition(node.meta),
});

export const nodeFingerprint = (node: GraphNode): string => stableJson(nodeShape(node));

/**
 * The fields of an edge that make it what it is.
 *
 * `line` is left out for the same reason it is left out of a node. `file` is
 * kept: a call that moved to another file is a different call site, and there
 * is no `moved` bucket for edges to put it in.
 */
const edgeShape = (edge: GraphEdge): Record<string, unknown> => ({
  confidence: edge.confidence,
  params: edge.params ?? null,
  returns: edge.returns ?? null,
  file: edge.file ?? null,
  meta: metaWithoutPosition(edge.meta),
});

export const edgeFingerprint = (edge: GraphEdge): string => stableJson(edgeShape(edge));

/**
 * Which fields of two shapes read differently, named the way a person would.
 *
 * `meta` is descended into one level, so a report says `meta.order` rather than
 * `meta`, which would be true of every node whose passes wrote anything.
 */
const differingFields = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] => {
  const fields: string[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]).values()) {
    if (key === 'meta') continue;
    if (stableJson(before[key]) !== stableJson(after[key])) fields.push(key);
  }
  const beforeMeta = (before['meta'] ?? {}) as Record<string, unknown>;
  const afterMeta = (after['meta'] ?? {}) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(beforeMeta), ...Object.keys(afterMeta)]).values()) {
    if (stableJson(beforeMeta[key]) !== stableJson(afterMeta[key])) fields.push(`meta.${key}`);
  }
  return fields.sort();
};

export const changedNodeFields = (before: GraphNode, after: GraphNode): string[] =>
  differingFields(nodeShape(before), nodeShape(after));

export const changedEdgeFields = (before: GraphEdge, after: GraphEdge): string[] =>
  differingFields(edgeShape(before), edgeShape(after));
