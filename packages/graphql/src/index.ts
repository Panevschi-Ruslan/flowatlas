/**
 * GraphQL, both halves (P232): the language read, a client's operations found
 * in TypeScript, and what a server's resolvers and schema declare.
 *
 * A package of its own because three readers and the linker need the same
 * reading of the language, and the core may name no technology (I1). It
 * draws nothing: each reader turns what this finds into its own nodes.
 */
export { GraphqlSyntaxError, isNullable, namedTypeOf, parseDocument, tryParse, typeText } from './parse.js';
export type {
  Argument,
  Definition,
  Document,
  FieldDefinition,
  FieldSelection,
  FragmentDefinition,
  InlineFragment,
  InputValue,
  OperationDefinition,
  Selection,
  TypeDefinition,
  TypeRef,
} from './parse.js';
export { mergeSchemas, namedTypeIn, rootTypeOf, schemaOf } from './schema.js';
export type { SchemaField, SchemaSummary, SchemaType } from './schema.js';
export { fragmentsOf, operationsOf, reachedFields } from './operations.js';
export type { Operation, Reached, SelectedField } from './operations.js';
export { documentOf, lineInFile } from './documents.js';
export type { DocumentReading } from './documents.js';
export { clientEndpointIn, fetchedDocument, graphqlCallOf, SERVICE_SENDS, serviceDocumentOf } from './calls.js';
export type { GraphqlCall, GraphqlLibrary } from './calls.js';
export { readGraphqlServer } from './servers.js';
export type { ResolvedField, ServerReading } from './servers.js';
export { GRAPHQL_META, operationMeta, type GraphqlCallMeta } from './meta.js';
