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

/**
 * A JSON Schema node, in the shape a document actually writes one.
 *
 * Recursive, so it is declared through `z.lazy`. The `$ref` case is what makes
 * a document a graph rather than a tree, and the composition keywords are kept
 * because a generated document splits a shape across `allOf` far more often
 * than a handwritten one does.
 */
export interface JsonSchemaNode {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  allOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
  nullable?: boolean;
  additionalProperties?: boolean | JsonSchemaNode;
  description?: string;
}

export const jsonSchemaNodeSchema: z.ZodType<JsonSchemaNode> = z.lazy(() =>
  z.looseObject({
    $ref: z.string().optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
    format: z.string().optional(),
    enum: z.array(z.unknown()).optional(),
    items: jsonSchemaNodeSchema.optional(),
    properties: z.record(z.string(), jsonSchemaNodeSchema).optional(),
    required: z.array(z.string()).optional(),
    allOf: z.array(jsonSchemaNodeSchema).optional(),
    oneOf: z.array(jsonSchemaNodeSchema).optional(),
    anyOf: z.array(jsonSchemaNodeSchema).optional(),
    nullable: z.boolean().optional(),
    additionalProperties: z.union([z.boolean(), jsonSchemaNodeSchema]).optional(),
    description: z.string().optional(),
  }),
);

/** A body or an answer, under the media types it may be carried as. */
export const contentSchema = z.record(
  z.string(),
  z.looseObject({ schema: jsonSchemaNodeSchema.optional() }),
);

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

/**
 * The verbs an operation may be spelled under, and what each one is called here.
 *
 * A lookup rather than a run of tests, and the source of truth for which keys
 * of a path item are operations at all: a path item also carries `parameters`,
 * `summary` and `$ref`, and treating one of those as a verb would invent a
 * route nobody declared.
 */
export const OPERATION_VERBS: Record<string, string> = {
  get: 'GET',
  put: 'PUT',
  post: 'POST',
  delete: 'DELETE',
  options: 'OPTIONS',
  head: 'HEAD',
  patch: 'PATCH',
  trace: 'ALL',
};
