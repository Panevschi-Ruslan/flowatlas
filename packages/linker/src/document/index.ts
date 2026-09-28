/**
 * What a document is, whatever format it is written in.
 *
 * The decisions every reader shares, the JSON Schema description they all read
 * shapes with, and the lookup from a kind to the reader for it.
 */
export {
  DECLARED_BY,
  DocumentError,
  shapeName,
  type DocumentReader,
  type ReadDocumentOptions,
  type ReadDocumentResult,
} from './declared.js';
export { DOCUMENT_KINDS, DOCUMENT_READERS, documentReader } from './readers.js';
export { contentSchema, jsonSchemaNodeSchema } from './schema.js';
export type { JsonSchemaNode } from './schema.js';
