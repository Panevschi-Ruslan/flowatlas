import { freshnessSchema, projectGraphSchema, repoGraphSchema, SCHEMA_VERSION } from '@flowatlas/core';
import { z } from 'zod';
import { DIFF_FORMAT_VERSION } from './diff/types.js';
import { graphDiffSchema } from './diff/schema.js';
import { DOCS_FORMAT_VERSION, docsIndexSchema } from './docs/index-file.js';

/**
 * The JSON files flowatlas writes, as JSON Schemas (P237): what a script, a
 * pipeline or another tool can build on, each at the version the tool already
 * bumps when the file changes (I11). Generated from the zod schemas the tool
 * itself reads these files with, never written by hand, so a schema cannot
 * drift from the reader (D3).
 */
export interface PublishedSchema {
  /** The file name under `schema/`. */
  file: string;
  /** The file it describes, as `docs/formats.md` names it. */
  describes: string;
  schema: Record<string, unknown>;
}

const BASE = 'https://raw.githubusercontent.com/Panevschi-Ruslan/flowatlas/main/schema';

const published = (file: string, describes: string, schema: z.ZodType): PublishedSchema => ({
  file,
  describes,
  schema: {
    $id: `${BASE}/${file}`,
    title: describes,
    ...(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>),
  },
});

export const PUBLISHED_SCHEMAS = (): PublishedSchema[] => [
  published(`project-graph.v${SCHEMA_VERSION}.schema.json`, '<output>/project-graph.json, the whole graph', projectGraphSchema),
  published(`repo-graph.v${SCHEMA_VERSION}.schema.json`, "<output>/services/<name>/graph.json, one service's own graph", repoGraphSchema),
  published(`diff.v${DIFF_FORMAT_VERSION}.schema.json`, '<output>/diff.json, what flowatlas diff found', graphDiffSchema),
  published(`docs.v${DOCS_FORMAT_VERSION}.schema.json`, '<output>/docs.json, the doc blocks and mentions flowatlas docs read', docsIndexSchema),
  published('freshness.v1.schema.json', "<output>/freshness.json, each service's checkout and every file a build read", freshnessSchema),
];
