import { DEFAULT_EVENT_BUS } from '@flowatlas/aws';
import type { MessageTarget } from '@flowatlas/core';
import { asText, fromJson, list, object, type Because, type Instance, type Value } from '../eval/values.js';
import { argument, HOLE, referencesOf, textOf, textWithHoles, whyNot } from './arguments.js';
import { busOf, deployedOf, deployedOfValue, isBecause } from './deployed.js';
import type { Placeholders } from './documents.js';
import type { ResourceReading } from './reading.js';

/**
 * A route that sends the request on to a queue, a topic or a bus itself.
 *
 * API Gateway can integrate a route with a service directly: the request
 * becomes a message on a queue or an event on a bus, and no function runs in
 * between. Such a route is the way in and the publisher at once. A REST API says
 * so in the integration's `uri` - `arn:aws:apigateway:<region>:sqs:path/<account>/<queue>`,
 * or an action (`sqs:action/SendMessage`, `sns:action/Publish`,
 * `events:action/PutEvents`) with the address in a request parameter or the
 * request template - and an HTTP API in its `integration_subtype` with the
 * address among `request_parameters`.
 *
 * Each shape is a row: what it is recognised by, and where it names its
 * address. Anything else is not a messaging integration and is left to the
 * function reading.
 */

type Sent = { readonly sends: MessageTarget } | Because;

/** What an integration says, by what it means rather than by what either way of writing one calls it. */
export type IntegrationField = 'type' | 'subtype' | 'uri' | 'parameters' | 'templates';

/**
 * An integration, wherever it is written: the arguments of a resource, or the
 * `x-amazon-apigateway-integration` of an operation in an OpenAPI document an
 * API is given as its body (R174).
 *
 * An Adapter. The shapes below, and the reading of the function an integration
 * invokes, ask it for a field and never learn which of the two they read.
 */
export interface Integration {
  /** A field as a reader would point at it: `uri of aws_api_gateway_integration.x`. */
  describe(field: IntegrationField): string;
  value(field: IntegrationField): Value | undefined;
  /** As text, each part that is not read standing as {@link HOLE}. */
  text(field: IntegrationField): string | undefined;
  /** Every reference written inside a field, each evaluated on its own. */
  references(field: IntegrationField): Value[];
}

/** The argument each field is, by the kind of API the resource belongs to. */
const RESOURCE_FIELDS: Readonly<Record<'rest' | 'http', Partial<Record<IntegrationField, string>>>> = {
  rest: { type: 'type', uri: 'uri', parameters: 'request_parameters', templates: 'request_templates' },
  http: {
    type: 'integration_type',
    subtype: 'integration_subtype',
    uri: 'integration_uri',
    parameters: 'request_parameters',
    templates: 'request_templates',
  },
};

/** An integration declared as a resource: `aws_api_gateway_integration`, `aws_apigatewayv2_integration`. */
export const resourceIntegration = (instance: Instance, api: 'rest' | 'http'): Integration => {
  const named = (field: IntegrationField): string | undefined => RESOURCE_FIELDS[api][field];
  const valueOf = (field: IntegrationField): Value | undefined => {
    const name = named(field);
    return name === undefined ? undefined : argument(instance, name);
  };
  return {
    describe: (field) => `${named(field) ?? field} of ${instance.address}`,
    value: valueOf,
    text: (field) => {
      const name = named(field);
      return name === undefined ? undefined : (textOf(valueOf(field)) ?? textWithHoles(instance, name));
    },
    references: (field) => {
      const name = named(field);
      return name === undefined ? [] : referencesOf(instance, name);
    },
  };
};

/** The member each field is in a document's extension. */
const DOCUMENT_FIELDS: Readonly<Record<IntegrationField, string>> = {
  type: 'type',
  subtype: 'integrationSubtype',
  uri: 'uri',
  parameters: 'requestParameters',
  templates: 'requestTemplates',
};

/**
 * An integration written in a document, with the placeholders the document was
 * handed over with: a member that is one placeholder is what it stands for.
 */
export const documentIntegration = (extension: Readonly<Record<string, unknown>>, where: string, placeholders: Placeholders): Integration => {
  const valueOf = (json: unknown): Value => {
    if (typeof json === 'string') return placeholders.valueIn(json);
    if (Array.isArray(json)) return list(json.map(valueOf));
    if (json !== null && typeof json === 'object') return object(new Map(Object.entries(json).map(([key, inner]) => [key, valueOf(inner)])));
    return fromJson(json);
  };
  const raw = (field: IntegrationField): unknown => extension[DOCUMENT_FIELDS[field]];
  return {
    describe: (field) => `${DOCUMENT_FIELDS[field]} of ${where}`,
    value: (field) => (raw(field) === undefined ? undefined : valueOf(raw(field))),
    text: (field) => {
      const found = raw(field);
      return typeof found === 'string' ? placeholders.textIn(found) : undefined;
    },
    references: (field) => {
      const found = raw(field);
      return typeof found === 'string' ? placeholders.referencesIn(found) : [];
    },
  };
};

/** The integration an HTTP or a WebSocket API's route names as its target. */
export const integrationOfRoute = (route: Instance): Instance | undefined =>
  referencesOf(route, 'target')
    .map((value) => (value.kind === 'ref' ? value.target : value.kind === 'instance' ? value.instance : undefined))
    .find((target) => target?.type === 'aws_apigatewayv2_integration');

/** The type an integration says it is, in one case: a document writes `aws_proxy` where a resource writes `AWS_PROXY`. */
export const integrationType = (integration: Integration): string | undefined => textOf(integration.value('type'))?.toUpperCase();

const parameter = (integration: Integration, key: string): Value | undefined => {
  const parameters = integration.value('parameters');
  return parameters?.kind === 'object' ? parameters.entries.get(key) : undefined;
};

/** A queue or topic as a target, or why the value is not one. */
const named = (value: Value | undefined, kind: 'queue' | 'topic', what: string, reading: ResourceReading): Sent => {
  if (value === undefined) return whyNot(undefined, what);
  // A REST request parameter is a mapping expression; a literal in it is quoted.
  const unquoted = value.kind === 'string' ? { ...value, value: value.value.replace(/^'(.*)'$/, '$1') } : value;
  const found = deployedOfValue(unquoted, what, reading);
  if (isBecause(found)) return found;
  return found.kind === kind ? { sends: { kind, name: found.name } } : { reason: 'unplaced', text: `${what} names a ${found.kind}` };
};

/** The one value of a field the request template writes out, or why not. */
const templateField = (template: string, field: string): string | Because => {
  const found = [...template.matchAll(new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, 'g'))].map((match) => match[1] as string);
  if (found.length === 0) return { reason: 'absent', text: `the request template writes no ${field}` };
  if (new Set(found).size > 1) return { reason: 'several', text: `the request template writes ${found.length} different values of ${field}` };
  const [value] = found as [string];
  return /[$#]/.test(value) ? { reason: 'dynamic', text: `${field} is ${JSON.stringify(value)}, filled from the request` } : value;
};

/** An event put on a bus, from the values the integration gives its fields. */
const event = (bus: string | Because, source: string | Because, detailType: string | Because): Sent => {
  for (const part of [bus, source, detailType]) if (typeof part !== 'string') return part;
  return { sends: { kind: 'bus', name: bus as string, fields: { source: source as string, 'detail-type': detailType as string } } };
};

const textField = (value: Value | undefined, field: string): string | Because => {
  const text = value === undefined ? undefined : asText(value);
  if (text === undefined) return whyNot(value, field);
  return text.startsWith('$') ? { reason: 'dynamic', text: `${field} is ${JSON.stringify(text)}, filled from the request` } : text;
};

const REST_SERVICE = /^arn:[^:]+:apigateway:[^:]*:(sqs|sns|events):(path|action)\/([^/?]*)(.*)$/;

/** The queue a `sqs:path/<account>/<queue>` integration names. */
const queueInPath = (integration: Integration, rest: string, reading: ResourceReading): Sent => {
  const queue = rest.split('/')[1]?.split('?')[0];
  if (queue !== undefined && queue !== '' && !queue.includes(HOLE)) return { sends: { kind: 'queue', name: queue } };
  const referenced = integration.references('uri')
    .map((value) => deployedOf(value, reading))
    .find((found) => found !== undefined && !isBecause(found) && found.kind === 'queue');
  return referenced !== undefined && !isBecause(referenced)
    ? { sends: { kind: 'queue', name: referenced.name } }
    : { reason: 'unplaced', text: 'the queue in the integration uri is not written out' };
};

/** The event a `PutEvents` integration's request template writes out. */
const eventInTemplate = (integration: Integration): Sent => {
  const templates = integration.value('templates');
  const template =
    templates?.kind === 'object' ? [...templates.entries.values()].map(asText).find((text) => text !== undefined) : undefined;
  if (template === undefined) return whyNot(templates, 'the request template');
  const bus = templateField(template, 'EventBusName');
  return event(
    typeof bus === 'string' || bus.reason !== 'absent' ? bus : DEFAULT_EVENT_BUS,
    templateField(template, 'Source'),
    templateField(template, 'DetailType'),
  );
};

type RestShape = (integration: Integration, rest: string, reading: ResourceReading) => Sent;

/** REST integrations of type `AWS`, by `<service>:path` or `<service>:action/<action>` as the uri writes them. */
const REST_SHAPES: ReadonlyMap<string, RestShape> = new Map<string, RestShape>([
  ['sqs:path', queueInPath],
  [
    'sqs:action/SendMessage',
    (integration, _rest, reading) =>
      named(parameter(integration, 'integration.request.querystring.QueueUrl'), 'queue', 'QueueUrl', reading),
  ],
  [
    'sns:action/Publish',
    (integration, _rest, reading) =>
      named(parameter(integration, 'integration.request.querystring.TopicArn'), 'topic', 'TopicArn', reading),
  ],
  ['events:action/PutEvents', (integration) => eventInTemplate(integration)],
]);

type HttpShape = (integration: Integration, reading: ResourceReading) => Sent;

/** HTTP API integrations, by `integration_subtype`. */
const HTTP_SHAPES: ReadonlyMap<string, HttpShape> = new Map<string, HttpShape>([
  ['SQS-SendMessage', (integration, reading) => named(parameter(integration, 'QueueUrl'), 'queue', 'QueueUrl', reading)],
  [
    'EventBridge-PutEvents',
    (integration, reading) =>
      event(
        busOf(parameter(integration, 'EventBusName'), 'EventBusName', reading),
        textField(parameter(integration, 'Source'), 'Source'),
        textField(parameter(integration, 'DetailType'), 'DetailType'),
      ),
  ],
]);

const restSends = (integration: Integration, reading: ResourceReading): Sent | undefined => {
  if (integrationType(integration) !== 'AWS') return undefined;
  const uri = integration.text('uri');
  const match = uri === undefined ? null : REST_SERVICE.exec(uri);
  if (match === null) return undefined;
  const [, service, style, action = '', rest = ''] = match;
  const shape = REST_SHAPES.get(style === 'path' ? `${service}:path` : `${service}:action/${action}`);
  return shape?.(integration, `${action}${rest}`, reading);
};

const httpSends = (integration: Integration, reading: ResourceReading): Sent | undefined => {
  const subtype = textOf(integration.value('subtype'));
  return subtype === undefined ? undefined : HTTP_SHAPES.get(subtype)?.(integration, reading);
};

/**
 * What a route's integration sends to, when it sends to a queue, a topic or a
 * bus rather than invoking a function; `undefined` when it does not. A REST
 * shape is recognised by its `uri` and an HTTP API one by its subtype, so one
 * integration is asked both ways and answers to at most one.
 */
export const sentBy = (integration: Integration, reading: ResourceReading): Sent | undefined =>
  restSends(integration, reading) ?? httpSends(integration, reading);
