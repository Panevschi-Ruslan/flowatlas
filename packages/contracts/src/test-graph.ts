/**
 * Small graphs and small shapes, built by hand.
 *
 * A test that has to run an extractor to ask one question about the comparator
 * is a test of the extractor. These build exactly the two shapes a case is
 * about and nothing else, so a failure names the rule rather than the fixture.
 */
import { structuralHash, type GraphEdge, type GraphNode, type ProjectGraph, type TypeEntry, type TypeField, type TypeRegistry } from '@flowatlas/core';

/** A field, written the way a test wants to read it. */
export const field = (
  name: string,
  type: string,
  optional = false,
  meta?: Record<string, unknown>,
): TypeField => ({ name, type, optional, ...(meta === undefined ? {} : { meta }) });

/**
 * An object shape with its hash already taken.
 *
 * The hash is what the check short-circuits on, so a hand-built entry that
 * carried a made-up one would exercise a path no real graph reaches.
 */
export const object = (
  name: string,
  fields: TypeField[],
  registry: TypeRegistry = {},
  meta?: Record<string, unknown>,
): TypeEntry => {
  const entry: TypeEntry = {
    name,
    kind: 'object',
    declaredIn: `test#${name}.ts`,
    structuralHash: '',
    fields,
    ...(meta === undefined ? {} : { meta }),
  };
  return { ...entry, structuralHash: structuralHash(entry, registry) };
};

/** A named set of values, as an enum or as a union of literals. */
export const values = (
  name: string,
  kind: 'enum' | 'union',
  members: string[],
  registry: TypeRegistry = {},
): TypeEntry => {
  const entry: TypeEntry = {
    name,
    kind,
    declaredIn: `test#${name}.ts`,
    structuralHash: '',
    members,
  };
  return { ...entry, structuralHash: structuralHash(entry, registry) };
};

/** A registry keyed the way the graph keys it. */
export const registryOf = (entries: Record<string, TypeEntry>): TypeRegistry => entries;

export interface GraphParts {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  types?: TypeRegistry;
}

/** A project graph with only what a case needs on it. */
export const graphOf = (parts: GraphParts): ProjectGraph => ({
  schemaVersion: 3,
  builtAt: '2026-01-01T00:00:00.000Z',
  services: [],
  nodes: parts.nodes ?? [],
  edges: parts.edges ?? [],
  types: parts.types ?? {},
  unresolved: [],
});

/** A node, with the two fields every one of them needs and nothing more. */
export const node = (
  id: string,
  type: GraphNode['type'],
  repo: string,
  extra: Partial<GraphNode> = {},
): GraphNode => ({ id, type, label: id, repo, ...extra });

/** An edge, with the three fields that identify it. */
export const edge = (
  from: string,
  type: GraphEdge['type'],
  to: string,
  extra: Partial<GraphEdge> = {},
): GraphEdge => ({ from, to, type, confidence: 'static', ...extra });
