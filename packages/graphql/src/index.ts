/**
 * GraphQL, both halves (P232): the language read, a client's operations found
 * in TypeScript, and what a server's resolvers and schema declare.
 *
 * A package of its own because three readers and the linker need the same
 * reading of the language, and the core may name no technology (I1). It
 * draws nothing: each reader turns what this finds into its own nodes.
 */
export { argumentOf, GraphqlSyntaxError, isNullable, namedTypeOf, parseDocument, stringsOf, tryParse, typeText } from './parse.js';
export type {
  AppliedDirective,
  Argument,
  EnumValue,
  Value,
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
export {
  authLabel,
  authOf,
  contextFieldOf,
  federationNamesOf,
  fieldFederationOf,
  mergeAuth,
  mergeSchemas,
  namedTypeIn,
  rootTypeOf,
  schemaOf,
  selectionText,
  typeFederationOf,
} from './schema.js';
export type { AuthRequirement, ComposedDirective, FieldFederation, SchemaField, SchemaSummary, SchemaType, TypeFederation } from './schema.js';
export { apiSchemaOf, composeSubgraphs, contextName, fieldSetNames, isSupergraph, supergraphComposition, unreachableOwners } from './federation.js';
export type { ComposedField, ComposedType, Composition, CompositionConflict, ContextArgument, FieldOwner, SubgraphSchema, SupergraphGraph } from './federation.js';
export { planSelection } from './plan.js';
export type { PlanOptions, PlanStep } from './plan.js';
export { addressOf, addressOfText, besideFile, readGraphqlGateway, readRouterConfig, readRoverConfig, routeAddress } from './gateway.js';
export type { Address, GatewayMeta, GatewayReading, GatewayRouteMeta, SubgraphRoute, UnreadDetail } from './gateway.js';
export { fragmentsOf, operationsOf, reachedFields } from './operations.js';
export type { Operation, Reached, SelectedField } from './operations.js';
export { documentOf, lineInFile } from './documents.js';
export type { DocumentReading } from './documents.js';
export { clientEndpointIn, fetchedDocument, graphqlCallOf, SERVICE_SENDS, serviceDocumentOf } from './calls.js';
export type { GraphqlCall, GraphqlLibrary } from './calls.js';
export { listenPortsOf, readGraphqlServer, REFERENCE_FIELD } from './servers.js';
export type { ListenPort, ResolvedField, ServerReading } from './servers.js';
export { GRAPHQL_META, operationMeta, type GraphqlCallMeta, type MetaField } from './meta.js';
