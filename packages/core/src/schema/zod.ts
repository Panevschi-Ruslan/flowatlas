import { z } from 'zod';
import { SchemaVersionMismatchError } from '../errors.js';
import { CONFIDENCE_LEVELS, EDGE_TYPES } from '../model/edges.js';
import type { ProjectGraph, RepoGraph } from '../model/graph.js';
import { ENTRY_KINDS, isEntryKind, NODE_TYPES } from '../model/nodes.js';
import { TYPE_KINDS } from '../model/types.js';
import { SCHEMA_VERSION } from './version.js';

const metaSchema = z.record(z.string(), z.unknown());

export const graphNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(NODE_TYPES),
    label: z.string(),
    repo: z.string().min(1),
    file: z.string().optional(),
    line: z.number().int().nonnegative().optional(),
    kind: z.string().optional(),
    meta: metaSchema.optional(),
  })
  .superRefine((node, ctx) => {
    if (node.type !== 'entry') return;
    if (node.kind === undefined || !isEntryKind(node.kind)) {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: `An entry node needs kind to be one of: ${ENTRY_KINDS.join(', ')}.`,
      });
    }
  });

export const graphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(EDGE_TYPES),
  confidence: z.enum(CONFIDENCE_LEVELS),
  params: z.array(z.string()).optional(),
  returns: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
  meta: metaSchema.optional(),
});

export const typeFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  optional: z.boolean(),
  meta: metaSchema.optional(),
});

export const typeEntrySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(TYPE_KINDS),
  declaredIn: z.string(),
  structuralHash: z.string(),
  fields: z.array(typeFieldSchema).optional(),
  members: z.array(z.string()).optional(),
  typeParams: z.array(z.string()).optional(),
  meta: metaSchema.optional(),
});

export const typeRegistrySchema = z.record(z.string(), typeEntrySchema);

export const unresolvedSchema = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
  reason: z.string().min(1),
  level: z.enum(['action', 'info']).optional(),
  sites: z.number().int().positive().optional(),
  message: z.string().optional(),
  hint: z.string().optional(),
  symbol: z.string().optional(),
  adapter: z.string().optional(),
  service: z.string().optional(),
  meta: metaSchema.optional(),
});

const graphBodySchema = {
  schemaVersion: z.number().int().positive(),
  generatedAt: z.string().min(1),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  types: typeRegistrySchema,
  unresolved: z.array(unresolvedSchema),
  meta: metaSchema.optional(),
};

export const repoGraphSchema = z.object({
  ...graphBodySchema,
  repo: z.string().min(1),
});

export const serviceSummarySchema = z.object({
  name: z.string().min(1),
  repo: z.string().min(1),
  type: z.string().min(1),
  extractor: z.string().nullable(),
  skipped: z.enum(['no-extractor', 'extract-failed']).optional(),
});

const { generatedAt: _generatedAt, ...projectBodySchema } = graphBodySchema;

export const projectGraphSchema = z.object({
  ...projectBodySchema,
  builtAt: z.string().min(1),
  services: z.array(serviceSummarySchema),
});

/** Throws {@link SchemaVersionMismatchError} unless the version is the current one. */
export const assertSchemaVersion = (found: unknown): void => {
  if (found !== SCHEMA_VERSION) throw new SchemaVersionMismatchError(found, SCHEMA_VERSION);
};

const versionOf = (input: unknown): unknown =>
  typeof input === 'object' && input !== null
    ? (input as { schemaVersion?: unknown }).schemaVersion
    : undefined;

/** Version check first, then full validation. */
export const parseRepoGraph = (input: unknown): RepoGraph => {
  assertSchemaVersion(versionOf(input));
  return repoGraphSchema.parse(input) as RepoGraph;
};

/** Version check first, then full validation. */
export const parseProjectGraph = (input: unknown): ProjectGraph => {
  assertSchemaVersion(versionOf(input));
  return projectGraphSchema.parse(input) as ProjectGraph;
};
