/**
 * JSON Schema, in the shape a document actually writes one.
 *
 * Every format this tool reads a declared service out of describes its payloads
 * in JSON Schema, and that is not a coincidence about two specifications: it is
 * the one vocabulary the wire has. So the description lives here rather than
 * under the reader that needed it first, and neither reader owns it.
 *
 * A description rather than a parser, and deliberately much smaller than the
 * specification. Unknown keys are kept rather than refused: a document is
 * somebody else's file, often generated, and failing on a keyword this release
 * has not heard of would make a reader brittle in exactly the way a third
 * party's artefact is guaranteed to break it.
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
