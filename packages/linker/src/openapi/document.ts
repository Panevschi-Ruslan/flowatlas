/**
 * The part of an OpenAPI document this tool has any use for, as a schema.
 *
 * A description rather than a parser, and deliberately much smaller than the
 * specification: the tool models routes, verbs, path parameters, request shapes
 * and response shapes, and a document is read only for those. Everything else a
 * document may carry — servers, security schemes, examples, links, callbacks —
 * is passed over rather than half-understood, because a fact this graph cannot
 * hold is a fact nothing downstream could have asked about anyway.
 *
 * Unknown keys are kept rather than refused. A document is somebody else's
 * file, often generated, and failing on a keyword this release has not heard of
 * would make the reader brittle in exactly the way a third party's artefact is
 * guaranteed to break it.
 */
import { z } from 'zod';
import { contentSchema, jsonSchemaNodeSchema } from '../document/schema.js';

// Re-exported because a document's schemas are part of this reader's published
// surface and were part of it before the description was shared with a second
// format. Where they live says who else reads them, not who may.
export { contentSchema, jsonSchemaNodeSchema } from '../document/schema.js';
export type { JsonSchemaNode } from '../document/schema.js';

export const parameterSchema = z.looseObject({
  name: z.string(),
  in: z.string(),
  required: z.boolean().optional(),
  schema: jsonSchemaNodeSchema.optional(),
});

export const operationSchema = z.looseObject({
  operationId: z.string().optional(),
  summary: z.string().optional(),
  parameters: z.array(parameterSchema).optional(),
  requestBody: z.looseObject({ content: contentSchema.optional(), required: z.boolean().optional() }).optional(),
  responses: z.record(z.string(), z.looseObject({ content: contentSchema.optional() })).optional(),
});

export const openapiDocumentSchema = z.looseObject({
  openapi: z.string().optional(),
  /** Swagger 2 spells its version here instead, and is refused by name below. */
  swagger: z.string().optional(),
  info: z.looseObject({ title: z.string().optional(), version: z.string().optional() }).optional(),
  paths: z.record(z.string(), z.looseObject({})).default({}),
  components: z
    .looseObject({ schemas: z.record(z.string(), jsonSchemaNodeSchema).optional() })
    .optional(),
});

export type OpenapiDocument = z.infer<typeof openapiDocumentSchema>;
export type Operation = z.infer<typeof operationSchema>;

// Which keys of a path item are verbs, and the walk over them, are shared with
// the deployment reader that reads an API created from a document (R174), so
// they live where both can reach them. Re-exported because they were part of
// this reader's surface first.
export { OPERATION_VERBS } from '@flowatlas/core';
