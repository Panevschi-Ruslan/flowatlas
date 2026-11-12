import { GRAPHQL_META, namedTypeIn, type GraphqlCallMeta, type SchemaSummary } from '@flowatlas/graphql';
import { edgeKeyOf } from './key.js';
import type { ContractFinding, GraphLookup } from './types.js';

/**
 * A GraphQL operation compared with the schema of the service it reached
 * (P232).
 *
 * The one contract REST cannot have: a request names every field it reads,
 * and the server's schema names every field there is. Three rules:
 *
 * - `graphql-field-unknown`: a selected field the type does not have. The
 *   server refuses the whole operation, so it is an error, at the line of
 *   the selection.
 * - `graphql-arg-unknown`: an argument the field does not take.
 * - `graphql-arg-required`: an argument the field requires and the selection
 *   does not write.
 * - `graphql-field-inaccessible`: a field a federated graph's composition
 *   hides from the API the router serves (`@inaccessible`, P241).
 *
 * Through a federation gateway the schema is the composition's (P241), so a
 * field no subgraph has is `graphql-field-unknown` there, said of the gateway.
 *
 * Read off the request's `meta.graphql` and the endpoint's schema, so `diff`,
 * SARIF and `contracts` carry these as they carry every other finding.
 */
export const GRAPHQL_RULES = ['graphql-field-unknown', 'graphql-arg-unknown', 'graphql-arg-required', 'graphql-field-inaccessible'] as const;

type MetaField = GraphqlCallMeta['fields'][number];

export const graphqlFindings = (lookup: GraphLookup): ContractFinding[] => {
  const findings: ContractFinding[] = [];
  for (const edge of lookup.allEdges()) {
    if (edge.type !== 'hits' && edge.type !== 'http_calls') continue;
    const call = lookup.node(edge.from);
    const endpoint = lookup.node(edge.to);
    const operation = call?.meta?.[GRAPHQL_META] as GraphqlCallMeta | undefined;
    const served = endpoint?.meta?.[GRAPHQL_META] as { endpoint?: boolean; schema?: SchemaSummary; gateway?: unknown; open?: string } | undefined;
    // A gateway's own route to a subgraph carries no operation (P241).
    if (call === undefined || endpoint === undefined || operation === undefined || !Array.isArray(operation.fields) || served?.endpoint !== true || served.schema === undefined) continue;
    const composed = served.gateway !== undefined;
    const schema = served.schema;
    const rootType = schema.roots[operation.operation];
    if (rootType === undefined) continue;
    const named = operation.name ?? operation.operation;
    // A field from a fragment written in another file is at its line there.
    const at = (field: MetaField): string => `${field.file ?? operation.document.file}:${field.line}`;
    const finding = (rule: (typeof GRAPHQL_RULES)[number], field: string, owner: string, message: string, kind: ContractFinding['kind'], direction: ContractFinding['direction'], actual: string | null, expected: string | null): ContractFinding => ({
      severity: 'error',
      kind,
      edge: { from: edge.from, to: edge.to, type: edge.type },
      edgeKey: edgeKeyOf(edge),
      direction,
      sender: direction === 'response' ? { service: endpoint.repo, typeId: null, symbol: endpoint.id } : { service: call.repo, typeId: null, symbol: call.id },
      receiver: direction === 'response' ? { service: call.repo, typeId: null, symbol: call.id } : { service: endpoint.repo, typeId: null, symbol: endpoint.id },
      typeId: `graphql:${endpoint.repo}#${owner}`,
      field,
      expected,
      actual,
      rule,
      message,
      ignored: false,
      ignoredBy: null,
    });

    const walk = (type: string, fields: readonly MetaField[], above: string, depth: number): void => {
      if (depth > 32) return;
      for (const field of fields) {
        if (field.field === '__typename') continue;
        const owner = field.on ?? type;
        const path = above === '' ? (field.alias ?? field.field) : `${above}.${field.alias ?? field.field}`;
        const declared = schema.types[owner]?.fields?.[field.field];
        // A root field a server that answers some requests itself may answer is the linker's row, not an error (P266).
        if (schema.types[owner] !== undefined && declared === undefined && served.open !== undefined && depth === 0) continue;
        if (schema.types[owner] !== undefined && declared === undefined) {
          const none = composed ? `no subgraph ${endpoint.repo} composes has ${owner}.${field.field}; the router refuses the whole operation` : `${endpoint.repo}'s ${owner} has no such field; the server refuses the whole operation`;
          findings.push(finding('graphql-field-unknown', path, owner, `${named} selects ${owner}.${field.field} at ${at(field)}, and ${none}`, 'missing_required', 'response', field.field, null));
          continue;
        }
        if (declared === undefined) continue;
        if (declared.federation?.inaccessible === true) {
          findings.push(finding('graphql-field-inaccessible', path, owner, `${named} selects ${owner}.${field.field} at ${at(field)}, which ${endpoint.repo}'s composition marks @inaccessible; the router does not serve it and refuses the whole operation`, 'missing_required', 'response', field.field, null));
          continue;
        }
        const written = new Set(field.arguments ?? []);
        for (const name of written) {
          if (declared.args?.[name] === undefined) {
            findings.push(finding('graphql-arg-unknown', `${path}(${name})`, owner, `${named} hands ${owner}.${field.field} an argument ${name} at ${at(field)}, which the field does not take`, 'extra_field', 'request', name, null));
          }
        }
        for (const [name, arg] of Object.entries(declared.args ?? {})) {
          if (arg.required && !written.has(name)) {
            findings.push(finding('graphql-arg-required', `${path}(${name})`, owner, `${named} selects ${owner}.${field.field} at ${at(field)} without ${name}: ${arg.type}, which the field requires`, 'missing_required', 'request', null, arg.type));
          }
        }
        if (field.selections !== undefined) walk(namedTypeIn(declared.type), field.selections, path, depth + 1);
      }
    };
    walk(rootType, operation.fields, '', 0);
  }
  return findings;
};
