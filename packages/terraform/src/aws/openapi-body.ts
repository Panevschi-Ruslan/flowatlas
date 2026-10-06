import { documentOf, DocumentSyntaxError, OPERATION_VERBS, operationsOf, type PositionedDocument, type RouteTarget } from '@flowatlas/core';
import { attributeOf } from '../hcl/ast.js';
import type { Because } from '../eval/values.js';
import { joinSegments } from './addresses.js';
import { argument, siteOf, textOf, unreadRow } from './arguments.js';
import { definitionAt, Placeholders } from './documents.js';
import { documentIntegration, integrationType, sentBy } from './integrations.js';
import type { ResourceReader, ResourceReading, RouteGuard } from './reading.js';

/**
 * An API created from an OpenAPI document (R174).
 *
 * `aws_api_gateway_rest_api.body` and `aws_apigatewayv2_api.body` hand the API
 * its routes as a document - usually `templatefile("openapi.yaml", { ... })`
 * with the functions' ARNs among the variables - and each operation says what
 * answers it in `x-amazon-apigateway-integration`: a function's ARN, or a
 * service the request is sent to itself. The document is found the way a state
 * machine's definition is (`documents.ts`), so a variable that is a reference
 * stays one; its operations are walked by the walk every reader of an OpenAPI
 * document shares (`operationsOf`); and its integrations are read through the
 * `Integration` a resource's integration is read through, so a function, a queue,
 * a topic and a bus are recognised here exactly as they are there.
 */

/** API Gateway's own key for an operation that answers any verb, beside the document's verbs. */
const VERBS: Readonly<Record<string, string>> = { ...OPERATION_VERBS, 'x-amazon-apigateway-any-method': 'ALL' };

const EXTENSION = 'x-amazon-apigateway-integration';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The schemes an operation is secured by, as written: its own requirements, or the document's. */
const schemesOf = (operation: Readonly<Record<string, unknown>>, document: Readonly<Record<string, unknown>>): string[] => {
  const security = operation['security'] ?? document['security'];
  if (!Array.isArray(security)) return [];
  return [...new Set(security.filter(isRecord).flatMap((requirement) => Object.keys(requirement)))].sort();
};

/** What answers an operation: what its integration sends to, or the function it invokes. */
const targetOf = (
  extension: unknown,
  where: string,
  placeholders: Placeholders,
  reading: ResourceReading,
): RouteTarget | Because | undefined => {
  if (!isRecord(extension)) return undefined;
  const integration = documentIntegration(extension, where, placeholders);
  const type = integrationType(integration);
  return sentBy(integration, reading) ?? (type === 'AWS_PROXY' || type === 'AWS' ? reading.invoked(integration) : undefined);
};

const readBody: ResourceReader[1] = (api, reading) => {
  const attribute = attributeOf(api.block.body, 'body');
  if (attribute === undefined || textOf(argument(api, 'protocol_type')) === 'WEBSOCKET') return;
  const placeholders = new Placeholders();
  const read = definitionAt(attribute.expression, api.module.scopeOf(api), placeholders);
  const what = `the routes of ${api.address}, from its OpenAPI body`;
  if ('because' in read) {
    reading.rows.push(unreadRow(api, 'api-body-unread', what, read.because));
    return;
  }
  const { definition } = read;
  let document: PositionedDocument;
  try {
    document = documentOf(definition);
  } catch (cause) {
    if (!(cause instanceof DocumentSyntaxError)) throw cause;
    reading.rows.push(unreadRow(api, 'api-body-unread', what, { reason: 'not-a-document', text: `${definition.file} is not ${definition.kind === 'text' ? definition.format.toUpperCase() : 'a document'}: ${cause.message}` }));
    return;
  }
  const root = document.value;
  const paths = isRecord(root) ? root['paths'] : undefined;
  if (!isRecord(root) || !isRecord(paths)) {
    reading.rows.push(unreadRow(api, 'api-body-unread', what, { reason: 'absent', text: 'the document has no paths' }));
    return;
  }
  // Where the document is a file of its own, a route is placed in it; where it
  // is built in place, in the file and on the line it is built on.
  const at = (path: readonly (string | number)[]): { file: string; line: number } => {
    const found = document.at(path);
    return found === undefined ? siteOf(api) : { file: definition.file, line: found.line };
  };
  for (const { rawPath, key, verb, operation } of operationsOf(paths, VERBS)) {
    const site = at(['paths', rawPath, key]);
    const where = `${api.address}.body.paths[${JSON.stringify(rawPath)}].${key}`;
    const guards: RouteGuard[] = schemesOf(operation, root).map((label) => ({ label, ...site }));
    reading.route({
      address: where,
      symbol: api.address,
      ...site,
      method: verb,
      path: { kind: 'path', path: joinSegments('/', rawPath), api },
      rawPath,
      target: targetOf(operation[EXTENSION], `the integration of ${verb} ${rawPath} in ${api.address}`, placeholders, reading),
      guards,
    });
  }
};

export const OPENAPI_BODY_READERS: readonly ResourceReader[] = [
  ['aws_api_gateway_rest_api', readBody],
  ['aws_apigatewayv2_api', readBody],
];
