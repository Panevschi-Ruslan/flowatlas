import { DEFAULT_STAGE, deployedNameIn, executeApiAddress, executeApiServedAt } from '@flowatlas/aws';
import { makeHttpEntryKey, normalizePath, type PathStep, type PositionedDocument, type ServedAt } from '@flowatlas/core';
import { HOLE, Imported, intrinsicOf, isRecord, ServiceFileUnreadable, textOf, Unread, type ApiReference, type Deployed, type Resource } from '@flowatlas/serverless';
import { pushRootedRoute, pushRoute, type ApiLookup, type ApiOf, type EventSite } from './events.js';
import { withGlobals } from './functions.js';
import type { TemplateReading } from './reading.js';

/**
 * The APIs of a template and the routes written on them rather than on a
 * function's events (P246): the OpenAPI body of an `AWS::Serverless::Api` or
 * `HttpApi`, written in place, included, or in a file of its own; an HTTP or
 * WebSocket API written as `AWS::ApiGatewayV2` routes and integrations; and a
 * REST API written as `AWS::ApiGateway` resources and methods. Each route is
 * keyed as Terraform keys the same route (P21, P59), so a caller joins it
 * whichever way it was written.
 */

/** The API types an event can point at, by the kind of event. */
const API_TYPES = {
  rest: new Set(['AWS::Serverless::Api', 'AWS::ApiGateway::RestApi']),
  http: new Set(['AWS::Serverless::HttpApi', 'AWS::ApiGatewayV2::Api']),
};

/** The logical id the transform gives the API it makes for events that name none. */
const IMPLICIT = { rest: 'ServerlessRestApi', http: 'ServerlessHttpApi' };

/** What every route of an API stands behind unless the route says otherwise: an authoriser, an API key. */
const authOf = (properties: Record<string, unknown>): Pick<ApiOf, 'defaultAuthorizer' | 'apiKeyRequired'> => {
  const auth = isRecord(properties['Auth']) ? properties['Auth'] : {};
  const authorizer = textOf(auth['DefaultAuthorizer']);
  return { ...(authorizer === undefined ? {} : { defaultAuthorizer: authorizer }), ...(auth['ApiKeyRequired'] === true ? { apiKeyRequired: true } : {}) };
};

// ------------------------------------------------ where an API is served

/** A stage as `executeApiServedAt` takes it: its name where read, and whether whoever deploys chooses it. */
interface StageAt {
  readonly name?: string;
  readonly chosen?: boolean;
}

/**
 * Whether a parameter is one the deployment may be handed another value for
 * when it is run (P294): `sam deploy --parameter-overrides` overrides its
 * default and a samconfig's alike, and only the configuration's options - or
 * the parent template handing it down - settle it here.
 */
const chosenParameter = (reading: TemplateReading, name: string): boolean => {
  const parameter = reading.resolver.parameters.get(name);
  return parameter !== undefined && parameter.from !== 'option' && parameter.from !== 'parent';
};

/** Whether a value as written reads such a parameter: by `Ref`, or as `${Name}` in an `Fn::Sub` (P294). */
const readsChosenParameter = (reading: TemplateReading, value: unknown, depth = 0): boolean => {
  if (depth > 16 || value === null || typeof value !== 'object') return false;
  const intrinsic = intrinsicOf(value);
  if (intrinsic?.[0] === 'Ref') return typeof intrinsic[1] === 'string' && chosenParameter(reading, intrinsic[1]);
  if (intrinsic?.[0] === 'Fn::Sub') {
    const [text, variables] = Array.isArray(intrinsic[1]) ? intrinsic[1] : [intrinsic[1], undefined];
    const own = isRecord(variables) ? variables : {};
    const named = typeof text === 'string' ? [...text.matchAll(/\$\{([^}!.]+)\}/g)].map((found) => found[1] as string) : [];
    return named.some((name) => !(name in own) && chosenParameter(reading, name)) || readsChosenParameter(reading, variables, depth + 1);
  }
  return (Array.isArray(value) ? value : Object.values(value)).some((item) => readsChosenParameter(reading, item, depth + 1));
};

/** A property of a resource as the template writes it, before its parameters are put in. */
const writtenProperty = (reading: TemplateReading, resource: Resource, property: string): unknown => {
  const resources = reading.resolver.context.document['Resources'];
  const written = isRecord(resources) ? resources[resource.logicalId] : undefined;
  return isRecord(written) && isRecord(written['Properties']) ? written['Properties'][property] : undefined;
};

/** A property of the template's `Globals` for one API type, as written. */
const writtenGlobal = (reading: TemplateReading, kind: 'rest' | 'http', property: string): unknown => {
  const globals = reading.resolver.context.document['Globals'];
  const section = isRecord(globals) ? globals[kind === 'rest' ? 'Api' : 'HttpApi'] : undefined;
  return isRecord(section) ? section[property] : undefined;
};

/**
 * A stage name as written and as read (P294): the name, chosen when the
 * deployment is run where it reads a parameter that is, and any stage at all
 * where it is not read.
 */
const stageAt = (reading: TemplateReading, written: unknown, resolved: unknown): StageAt => {
  const name = textOf(resolved);
  const chosen = name === undefined || readsChosenParameter(reading, written);
  return { ...(name === undefined ? {} : { name }), ...(chosen ? { chosen } : {}) };
};

/** The resources that deploy an API written as resources to a stage, and the property naming the API. */
const STAGES: ReadonlyMap<string, string> = new Map([
  ['AWS::ApiGateway::Stage', 'RestApiId'],
  ['AWS::ApiGateway::Deployment', 'RestApiId'],
  ['AWS::ApiGatewayV2::Stage', 'ApiId'],
]);

/** Every stage an API written as resources is deployed to, by a `Ref` of it (P248, P294). */
const stagesOf = (reading: TemplateReading, api: Resource): StageAt[] => {
  const stages: StageAt[] = [];
  for (const resource of reading.template.resources.values()) {
    const property = STAGES.get(resource.type);
    const ref = property === undefined ? undefined : intrinsicOf(resource.properties[property]);
    if (ref?.[0] !== 'Ref' || ref[1] !== api.logicalId || resource.properties['StageName'] === undefined) continue;
    stages.push(stageAt(reading, writtenProperty(reading, resource, 'StageName'), resource.properties['StageName']));
  }
  return stages;
};

/**
 * The stage an API written as resources is deployed to (P248): the one name
 * every stage and deployment of it gives; none where it has several, or none
 * is written.
 */
const stageOf = (stages: readonly StageAt[]): string | undefined => {
  const names = new Set(stages.flatMap((stage) => stage.name ?? []));
  return names.size === 1 ? [...names][0] : undefined;
};

/**
 * Where an API is served (P294), as every route of it records: at the gateway
 * host of the template's region, any region where none is given, once per
 * stage it is deployed to - the stage `sam deploy` may choose open, with the
 * one it deploys to where nothing chooses - and at the root for an HTTP API's
 * default stage. An API with no stage read is served at a stage chosen when
 * it is deployed.
 */
const servedOf = (reading: TemplateReading, api: string, stages: readonly StageAt[]): ServedAt[] => {
  const all = (stages.length === 0 ? [{ chosen: true }] : stages).map((stage) => executeApiServedAt(reading.template.pseudo.region, api, stage));
  return [...new Map(all.map((served) => [JSON.stringify(served), served])).values()];
};

/** An API resource, as an event or a route sees it. */
const apiOf = (reading: TemplateReading, resource: Resource, kind: 'rest' | 'http'): ApiOf => {
  const serverless = resource.type.startsWith('AWS::Serverless::');
  const properties = serverless ? withGlobals(reading.globals[kind === 'rest' ? 'Api' : 'HttpApi'], resource.properties) : resource.properties;
  const name = textOf(properties['Name']);
  // The transform's API takes its stage, or its type's global one; an HTTP API with neither is served at its default stage.
  const written = serverless ? (writtenProperty(reading, resource, 'StageName') ?? writtenGlobal(reading, kind, 'StageName')) : undefined;
  const stages: StageAt[] = serverless
    ? properties['StageName'] === undefined
      ? kind === 'http'
        ? [{}]
        : []
      : [stageAt(reading, written, properties['StageName'])]
    : [...stagesOf(reading, resource), ...(resource.properties['Target'] === undefined ? [] : [{}])];
  const stage = serverless ? textOf(properties['StageName']) : stageOf(stages);
  return {
    ...(name === undefined ? {} : { name }),
    address: `${reading.file.file}#${resource.address}`,
    ...(stage === undefined ? {} : { stage }),
    served: servedOf(reading, name ?? resource.logicalId, stages),
    ...authOf(properties),
  };
};

/**
 * The API an event's `RestApiId` or `ApiId` points at; with none, the one the
 * transform makes for the whole template, which takes the stack's name.
 */
export const apiLookup =
  (reading: TemplateReading): ApiLookup =>
  (kind, reference, site) => {
    if (reference === undefined) {
      const globals = reading.globals[kind === 'rest' ? 'Api' : 'HttpApi'] ?? {};
      const stack = reading.template.pseudo.stackName;
      const name = stack === undefined || reading.scope !== '' ? undefined : stack;
      // `Prod` for a REST API and the default stage for an HTTP API, unless the globals name one (P294).
      const stage = globals['StageName'] === undefined ? { name: kind === 'rest' ? 'Prod' : DEFAULT_STAGE } : stageAt(reading, writtenGlobal(reading, kind, 'StageName'), globals['StageName']);
      return {
        ...(name === undefined ? {} : { name }),
        address: `${reading.file.file}#${reading.scope}${IMPLICIT[kind]}`,
        stage: textOf(globals['StageName']) ?? (kind === 'rest' ? 'Prod' : DEFAULT_STAGE),
        served: servedOf(reading, name ?? IMPLICIT[kind], [stage]),
        ...authOf(globals),
      };
    }
    const intrinsic = intrinsicOf(reference);
    const id = intrinsic?.[0] === 'Ref' && typeof intrinsic[1] === 'string' ? intrinsic[1] : undefined;
    const resource = id === undefined ? undefined : reading.template.resources.get(id);
    if (intrinsic?.[0] === 'Fn::ImportValue' || reading.template.deployedOf(reference) instanceof Imported) {
      // The transform takes an event's API only from the same template (P249), a parameter of the account's too (P253).
      reading.file.row(site.path, site.address, {
        reason: 'route-path-unread',
        message: `${site.address} is a route of an API another stack creates, which the transform does not take on an event: it requires an API the same template declares`,
        hint: 'Hang the route from the shared API with AWS::ApiGateway::Resource and AWS::ApiGateway::Method (or an AWS::ApiGatewayV2::Route), whose ParentId or ApiId imports it; those are joined to it.',
      });
      return undefined;
    }
    if (resource === undefined || !API_TYPES[kind].has(resource.type)) {
      reading.file.row(site.path, site.address, {
        reason: 'route-path-unread',
        message: `the API ${site.address} is a route of is not read: ${reference instanceof Unread ? reference.text : 'it is not a Ref of an API the template declares'}`,
        hint: `Point ${kind === 'rest' ? 'RestApiId' : 'ApiId'} at an API the template declares, with a Ref.`,
      });
      return undefined;
    }
    return apiOf(reading, resource, kind);
  };

// ------------------------------------------------------- what runs a route

/**
 * The function an integration's URI runs: a reference to it, or the
 * invocation URI with its ARN inside, written out or built with `Fn::Sub`.
 */
export const functionOfUri = (reading: TemplateReading, value: unknown): Deployed | Unread | undefined => {
  const direct = reading.deployedOf(value);
  if (direct !== undefined && !(direct instanceof Unread) && direct.kind === 'function') return direct;
  const text = reading.template.text(value);
  const written = typeof text === 'string' ? text : text.partial;
  const inner = written === undefined ? undefined : /\/functions\/(.+?)\/invocations/.exec(written)?.[1];
  const found = inner === undefined || inner.includes(HOLE) ? undefined : deployedNameIn(inner);
  if (found === undefined || found.kind !== 'function') return direct instanceof Unread ? direct : text instanceof Unread ? text : undefined;
  const own = reading.functionNamed(found.name);
  return { kind: 'function', name: found.name, ...(own === undefined ? {} : { function: own.index }) };
};

/** The verbs an OpenAPI path item holds operations under. */
const VERBS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'x-amazon-apigateway-any-method']);

/** A route already drawn, so a body and an event declaring the same one draw it once. */
const drawn = (reading: TemplateReading, api: ApiOf, method: string, path: string): boolean => {
  const key = makeHttpEntryKey(method, normalizePath(`/${path.replace(/^\/+/, '')}`));
  return reading.file.parts.routes.some((route) => route.meta?.['apiAddress'] === api.address && route.meta?.['key'] === key);
};

/**
 * Where each API type keeps its OpenAPI body: written in place, and in a file
 * - SAM's `DefinitionUri`, and the `BodyS3Location` a plain template names a
 * local file in for `aws cloudformation package` to upload (P248).
 */
const BODIES: ReadonlyMap<string, readonly [body: string, location: string]> = new Map([
  ['AWS::Serverless::Api', ['DefinitionBody', 'DefinitionUri']],
  ['AWS::Serverless::HttpApi', ['DefinitionBody', 'DefinitionUri']],
  ['AWS::ApiGateway::RestApi', ['Body', 'BodyS3Location']],
  ['AWS::ApiGatewayV2::Api', ['Body', 'BodyS3Location']],
]);

/** The body an API is defined by: written in place, included with `AWS::Include`, or a file of its own. */
const bodyOf = (
  reading: TemplateReading,
  resource: Resource,
): { readonly file: string; readonly document: PositionedDocument; readonly at: readonly PathStep[] } | Unread | undefined => {
  const [bodyKey, locationKey] = BODIES.get(resource.type) ?? ['DefinitionBody', 'DefinitionUri'];
  const body = resource.properties[bodyKey];
  const include = intrinsicOf(body);
  const location =
    include?.[0] === 'Fn::Transform' && isRecord(include[1]) && isRecord(include[1]['Parameters']) ? textOf(include[1]['Parameters']['Location']) : textOf(resource.properties[locationKey]);
  if (body !== undefined && include === undefined && isRecord(body)) return { file: reading.file.file, document: reading.file.document, at: [...resource.path, 'Properties', bodyKey] };
  if (body instanceof Unread) return body;
  if (location === undefined) return resource.properties[locationKey] === undefined && body === undefined ? undefined : new Unread('the body is in a location that is not a file of the repository');
  try {
    const local = reading.local(location);
    return local === undefined ? new Unread(`${location} is not a file of the repository`) : { ...local, at: [] };
  } catch (cause) {
    return new Unread(`${location} is not read: ${cause instanceof ServiceFileUnreadable ? cause.message : String(cause)}`);
  }
};

/** The routes of an API's OpenAPI body that an integration runs a function of this template for. */
const readBody = (reading: TemplateReading, resource: Resource, kind: 'rest' | 'http'): void => {
  const body = bodyOf(reading, resource);
  if (body === undefined) return;
  const site = { path: resource.path, address: resource.address };
  if (body instanceof Unread) {
    reading.file.row(site.path, site.address, {
      reason: 'api-body-unread',
      message: `the OpenAPI body of ${resource.address} is not read: ${body.text}`,
      hint: resource.type.startsWith('AWS::Serverless::')
        ? 'Write the body under DefinitionBody, include it with AWS::Include, or point DefinitionUri at a file of the repository.'
        : 'Write the body under Body, include it with AWS::Include, or point BodyS3Location at a file of the repository for aws cloudformation package to upload.',
    });
    return;
  }
  const own = body.file === reading.file.file;
  // A body in place has been resolved with the template; one in a file of its own is read as written.
  const value = own ? resource.properties[(BODIES.get(resource.type) ?? ['DefinitionBody'])[0]] : body.document.value;
  const paths = isRecord(value) && isRecord(value['paths']) ? value['paths'] : {};
  const api = apiOf(reading, resource, kind);
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue;
    for (const [verb, operation] of Object.entries(item)) {
      if (!VERBS.has(verb) || !isRecord(operation)) continue;
      const integration = operation['x-amazon-apigateway-integration'];
      if (!isRecord(integration) || drawn(reading, api, verb === 'x-amazon-apigateway-any-method' ? 'ALL' : verb.toUpperCase(), path)) continue;
      const fn = functionOfUri(reading, integration['uri']);
      const at = [...body.at, 'paths', path, verb];
      const line = body.document.at(at)?.line ?? body.document.at(body.at)?.line ?? 1;
      const address = `${resource.address}.paths.${path}.${verb}`;
      if (fn === undefined || fn instanceof Unread || fn.function === undefined) {
        reading.file.parts.rows.push({
          file: body.file,
          line,
          symbol: address,
          reason: 'route-target-unread',
          level: fn === undefined || fn instanceof Unread ? undefined : 'info',
          message: `what ${verb.toUpperCase()} ${path} of ${resource.address} runs is not read${fn instanceof Unread ? `: ${fn.text}` : fn === undefined ? ': its integration names no function' : `: ${fn.name} is not a function of this template`}`,
          hint: 'Write the integration uri as the invocation ARN of a function the template declares, through Fn::Sub.',
        });
        continue;
      }
      const site: EventSite = { to: { kind: 'function', function: fn.function }, function: fn.function, label: fn.name, logicalId: resource.logicalId, path: own ? at : resource.path, address };
      pushRoute(reading, site, verb, path, api, []);
      const route = reading.file.parts.routes[reading.file.parts.routes.length - 1];
      if (route !== undefined && !own) reading.file.parts.routes[reading.file.parts.routes.length - 1] = { ...route, file: body.file, line };
    }
  }
};

// --------------------------------------------- HTTP and WebSocket, written out

/** `integrations/<id>`, as a route's Target names its integration. */
const integrationOf = (reading: TemplateReading, target: unknown): Resource | undefined => {
  const text = reading.template.text(target);
  const written = typeof text === 'string' ? text : text.partial;
  const sub = intrinsicOf(target)?.[0] === 'Fn::Sub' ? textOf(intrinsicOf(target)?.[1]) : undefined;
  const id = /integrations\/\$\{([^}]+)\}/.exec(sub ?? '')?.[1] ?? /integrations\/([A-Za-z0-9]+)$/.exec(written ?? '')?.[1];
  const resource = id === undefined ? undefined : reading.template.resources.get(id);
  return resource?.type === 'AWS::ApiGatewayV2::Integration' ? resource : undefined;
};

/** An API of `AWS::ApiGatewayV2`, by what a route's ApiId points at. */
const v2ApiOf = (reading: TemplateReading, value: unknown): Resource | undefined => {
  const intrinsic = intrinsicOf(value);
  const id = intrinsic?.[0] === 'Ref' && typeof intrinsic[1] === 'string' ? intrinsic[1] : undefined;
  const resource = id === undefined ? undefined : reading.template.resources.get(id);
  return resource?.type === 'AWS::ApiGatewayV2::Api' || resource?.type === 'AWS::Serverless::HttpApi' ? resource : undefined;
};

/** `AWS::ApiGatewayV2::Route`: a route of an HTTP API, or a way in of a socket API, onto its integration's function. */
const readV2Route = (reading: TemplateReading, route: Resource): void => {
  const { properties } = route;
  const api = v2ApiOf(reading, properties['ApiId']);
  // A route of an HTTP API another stack creates hangs from that API (P249).
  const shared = api === undefined ? reading.template.deployedOf(properties['ApiId']) : undefined;
  const routeKey = textOf(properties['RouteKey']);
  const integration = integrationOf(reading, properties['Target']);
  const fn = integration === undefined ? undefined : functionOfUri(reading, integration.properties['IntegrationUri']);
  if (shared instanceof Imported && routeKey !== undefined && fn !== undefined && !(fn instanceof Unread) && fn.function !== undefined) {
    const site: EventSite = { to: { kind: 'function', function: fn.function }, function: fn.function, label: fn.name, logicalId: route.logicalId, path: route.path, address: route.address };
    const [method, path] = routeKey === '$default' ? ['ANY', '/{proxy+}'] : routeKey.split(/\s+/);
    pushRootedRoute(reading, site, method ?? 'ANY', shared.key, path ?? '/', []);
    return;
  }
  if (api === undefined || routeKey === undefined || fn === undefined || fn instanceof Unread || fn.function === undefined) {
    const missing = api === undefined ? 'the API it belongs to' : routeKey === undefined ? 'its route key' : integration === undefined ? 'its integration' : 'the function its integration runs';
    reading.file.row(route.path, route.address, {
      reason: 'route-target-unread',
      message: `${route.address} is not drawn: ${missing} is not read${fn instanceof Unread ? `: ${fn.text}` : ''}`,
      hint: 'Write ApiId as a Ref of the API, Target as !Sub integrations/${Integration}, and the integration uri as the invocation ARN of a function the template declares.',
    });
    return;
  }
  const site: EventSite = { to: { kind: 'function', function: fn.function }, function: fn.function, label: fn.name, logicalId: route.logicalId, path: route.path, address: route.address };
  const protocol = textOf(api.properties['ProtocolType']);
  const name = textOf(api.properties['Name']);
  if (protocol === 'WEBSOCKET') {
    reading.file.parts.deliveries.push({
      ...reading.file.siteOf(route.path),
      address: route.address,
      by: 'route',
      name: routeKey,
      from: { kind: 'connection', api: name ?? `${reading.file.file}#${api.address}`, route: routeKey },
      to: site.to,
      meta: { declaredAs: route.address, ...reading.conditionOf(route.logicalId) },
    });
    return;
  }
  const [method, path] = routeKey === '$default' ? ['ANY', '/{proxy+}'] : routeKey.split(/\s+/);
  const authorization = textOf(properties['AuthorizationType']);
  const guards = authorization === undefined || authorization === 'NONE' ? [] : [{ label: authorization, ...reading.file.siteOf(route.path) }];
  pushRoute(reading, site, method ?? 'ANY', path ?? '/', apiOf(reading, api, 'http'), guards);
};

/**
 * An HTTP API made in one resource (P248): `Target` is the function every
 * request runs, on the route `RouteKey` names, `$default` where it names none
 * - what `aws apigatewayv2 create-api --target` makes, written in a template.
 */
const readQuickCreate = (reading: TemplateReading, api: Resource): void => {
  const { properties } = api;
  const address = `${api.address}.Target`;
  const path = [...api.path, 'Properties', 'Target'];
  const routeKey = properties['RouteKey'] === undefined ? '$default' : textOf(properties['RouteKey']);
  const fn = functionOfUri(reading, properties['Target']);
  if (routeKey === undefined || fn === undefined || fn instanceof Unread || fn.function === undefined) {
    const proxied = /^https?:/.test(textOf(properties['Target']) ?? '');
    reading.file.row(path, address, {
      reason: 'route-target-unread',
      ...(proxied ? { level: 'info' as const } : {}),
      message: `${api.address} is not drawn: ${routeKey === undefined ? 'its RouteKey is not read' : proxied ? 'its Target is an HTTP address, which no function answers' : `the function its Target runs is not read${fn instanceof Unread ? `: ${fn.text}` : ''}`}`,
      hint: 'Write Target as a Ref or Fn::GetAtt of a function the template declares, or its ARN.',
    });
    return;
  }
  const site: EventSite = { to: { kind: 'function', function: fn.function }, function: fn.function, label: fn.name, logicalId: api.logicalId, path, address };
  const [method, routePath] = routeKey === '$default' ? ['ANY', '/{proxy+}'] : routeKey.split(/\s+/);
  pushRoute(reading, site, method ?? 'ANY', routePath ?? '/', apiOf(reading, api, 'http'), []);
};

// ----------------------------------------------------- REST, written out

/**
 * Where an `AWS::ApiGateway::Resource` is, built up its parents: a path from
 * the API's root, or a path below a point of an API another stack creates and
 * exports, which the linker places (P249).
 */
type RestPath = { readonly path: string } | { readonly root: string; readonly below: string };

/** The point of a REST API a value is: the root, a resource of the template, or one another stack exports. */
export const restPathOf = (reading: TemplateReading, value: unknown, depth = 0): RestPath | undefined => {
  if (depth > 16) return undefined;
  // A point of an API another deployment writes to a parameter of the account (P253).
  const shared = value instanceof Imported ? value : typeof value === 'string' ? reading.template.deployedOf(value) : undefined;
  if (shared instanceof Imported) return { root: shared.key, below: '' };
  const intrinsic = intrinsicOf(value);
  if (intrinsic === undefined) return undefined;
  if (intrinsic[0] === 'Fn::ImportValue') {
    const imported = reading.template.imported(intrinsic[1]);
    return imported instanceof Imported ? { root: imported.key, below: '' } : undefined;
  }
  if (intrinsic[0] === 'Fn::GetAtt') return { path: '' };
  const id = intrinsic[0] === 'Ref' && typeof intrinsic[1] === 'string' ? intrinsic[1] : undefined;
  const resource = id === undefined ? undefined : reading.template.resources.get(id);
  if (resource?.type !== 'AWS::ApiGateway::Resource') return undefined;
  const parent = restPathOf(reading, resource.properties['ParentId'], depth + 1);
  const part = textOf(resource.properties['PathPart']);
  if (parent === undefined || part === undefined) return undefined;
  return 'root' in parent ? { root: parent.root, below: `${parent.below}/${part}` } : { path: `${parent.path}/${part}` };
};

/** `AWS::ApiGateway::Method`: a route of a REST API, onto the function its integration runs. */
const readRestMethod = (reading: TemplateReading, method: Resource): void => {
  const { properties } = method;
  const verb = textOf(properties['HttpMethod']);
  const path = restPathOf(reading, properties['ResourceId']);
  const integration = isRecord(properties['Integration']) ? properties['Integration'] : {};
  const fn = functionOfUri(reading, integration['Uri']);
  const apiId = intrinsicOf(properties['RestApiId']);
  const apiResource = apiId?.[0] === 'Ref' && typeof apiId[1] === 'string' ? reading.template.resources.get(apiId[1]) : undefined;
  // A method on a point of an API another stack creates hangs from that point (P249).
  const rooted = path !== undefined && 'root' in path ? path : undefined;
  if (verb === undefined || path === undefined || (apiResource === undefined && rooted === undefined) || fn === undefined || fn instanceof Unread || fn.function === undefined) {
    const missing = verb === undefined ? 'its HttpMethod' : path === undefined ? 'the path of its resource' : apiResource === undefined ? 'the API it belongs to' : 'the function its integration runs';
    reading.file.row(method.path, method.address, {
      reason: 'route-target-unread',
      message: `${method.address} is not drawn: ${missing} is not read${fn instanceof Unread ? `: ${fn.text}` : ''}`,
      hint: 'Write ResourceId and RestApiId as Refs of what the template declares, and the integration Uri as the invocation ARN of one of its functions.',
    });
    return;
  }
  const site: EventSite = { to: { kind: 'function', function: fn.function }, function: fn.function, label: fn.name, logicalId: method.logicalId, path: method.path, address: method.address };
  const authorization = textOf(properties['AuthorizationType']);
  const at = reading.file.siteOf(method.path);
  const guards = [
    ...(authorization === undefined || authorization === 'NONE' ? [] : [{ label: authorization, ...at }]),
    ...(properties['ApiKeyRequired'] === true ? [{ label: 'api key', ...at }] : []),
  ];
  if (rooted !== undefined) {
    pushRootedRoute(reading, site, verb, rooted.root, rooted.below === '' ? '/' : rooted.below, guards);
    return;
  }
  if (!('path' in path) || apiResource === undefined) return;
  pushRoute(reading, site, verb, path.path === '' ? '/' : path.path, apiOf(reading, apiResource, 'rest'), guards);
};

/** Every logical id a value refers to: `Ref`, `Fn::GetAtt`, and each `${Id}` or `${Id.Attribute}` of `Fn::Sub`. */
const referencedIds = (value: unknown, depth = 0): [string, string | undefined][] => {
  if (depth > 16) return [];
  const intrinsic = intrinsicOf(value);
  if (intrinsic === undefined) {
    if (Array.isArray(value)) return value.flatMap((item) => referencedIds(item, depth + 1));
    return isRecord(value) ? Object.values(value).flatMap((item) => referencedIds(item, depth + 1)) : [];
  }
  const [fn, argument] = intrinsic;
  if (fn === 'Ref' && typeof argument === 'string') return argument.startsWith('AWS::') ? [] : [[argument, undefined]];
  if (fn === 'Fn::GetAtt') {
    const [id, attribute] = Array.isArray(argument) ? argument : typeof argument === 'string' ? argument.split('.') : [];
    return typeof id === 'string' ? [[id, typeof attribute === 'string' ? attribute : undefined]] : [];
  }
  if (fn === 'Fn::Sub') {
    const [text, variables] = Array.isArray(argument) ? argument : [argument, undefined];
    const own = typeof text === 'string' ? [...text.matchAll(/\$\{([^}!]+)\}/g)].map((match) => match[1] as string) : [];
    return [
      ...own.filter((inside) => !inside.startsWith('AWS::') && !(isRecord(variables) && inside in variables)).map((inside): [string, string | undefined] => {
        const dot = inside.indexOf('.');
        return dot < 0 ? [inside, undefined] : [inside.slice(0, dot), inside.slice(dot + 1)];
      }),
      ...referencedIds(variables, depth + 1),
    ];
  }
  return referencedIds(argument, depth + 1);
};

/**
 * The API of the template a value a function is deployed with is the address
 * of, and the path it asks for there after the stage (P272): a URL built
 * around a reference to the API - `!Sub https://${Api}.execute-api.${AWS::Region}.amazonaws.com/${Stage}/orders`
 * - or an HTTP API's `ApiEndpoint`. The API's id is assigned when it is
 * created; the reference says which API it is. A value that refers to the API
 * by anything else - its id alone - is no address, and is not one here.
 */
export const apiValueOf =
  (reading: TemplateReading) =>
  (value: unknown): { readonly name: string; readonly path?: string } | undefined => {
    if (intrinsicOf(value) === undefined) return undefined;
    const apis = new Map<string, { api: ApiOf; kind: 'rest' | 'http'; attribute: string | undefined }>();
    for (const [id, attribute] of referencedIds(value)) {
      const resource = reading.template.resources.get(id);
      const implicit = (Object.entries(IMPLICIT) as ['rest' | 'http', string][]).find(([, logicalId]) => logicalId === id && resource === undefined);
      const kind = implicit?.[0] ?? (resource !== undefined && API_TYPES.rest.has(resource.type) ? 'rest' : resource !== undefined && API_TYPES.http.has(resource.type) ? 'http' : undefined);
      if (kind === undefined) continue;
      const api = resource === undefined ? apiLookup(reading)(kind, undefined, { path: [], address: id } as unknown as Parameters<ApiLookup>[2]) : apiOf(reading, resource, kind);
      if (api !== undefined) apis.set(api.address, { api, kind, attribute });
    }
    const [only, ...rest] = [...apis.values()];
    if (only === undefined || rest.length > 0) return undefined;
    const name = only.api.name ?? only.api.address;
    const direct = intrinsicOf(value);
    if (direct?.[0] === 'Fn::GetAtt') return only.attribute === 'ApiEndpoint' ? { name, path: '/' } : undefined;
    if (direct?.[0] === 'Ref') return undefined;
    const built = reading.template.text(value);
    const text = typeof built === 'string' ? built : built.partial;
    const address = text === undefined ? undefined : executeApiAddress(text.split(HOLE).join('x'));
    if (address === undefined) return undefined;
    const stage = only.api.stage === '$default' ? undefined : only.api.stage;
    const [first, ...after] = address.segments;
    if (only.kind === 'http' && stage === undefined) return { name, path: `/${address.segments.join('/')}` };
    // A REST API is always served under its stage; where the stage is not read, the first segment is it.
    if (first === undefined || (stage !== undefined && first !== stage)) return undefined;
    return { name, path: `/${after.join('/')}` };
  };

/**
 * What an output of the template that refers to one of its APIs is (P249): a
 * `Ref` of the API, its `RootResourceId` or a `Ref` of one of its REST
 * resources is a point of it, for other stacks' routes to hang from; any other
 * attribute, or a URL built around it, is its address.
 */
export const apiReference =
  (reading: TemplateReading): ApiReference =>
  (logicalId, attribute) => {
    const point = attribute === undefined || attribute === 'RootResourceId' ? '/' : undefined;
    const implicit = (Object.entries(IMPLICIT) as ['rest' | 'http', string][]).find(([, id]) => id === logicalId);
    if (implicit !== undefined && !reading.template.resources.has(logicalId)) {
      const [kind] = implicit;
      const stack = reading.template.pseudo.stackName;
      return { kind, ...(stack === undefined || reading.scope !== '' ? {} : { name: stack }), address: `${reading.file.file}#${reading.scope}${logicalId}`, ...(point === undefined ? {} : { path: point }) };
    }
    const resource = reading.template.resources.get(logicalId);
    if (resource === undefined) return undefined;
    if (resource.type === 'AWS::ApiGateway::Resource') {
      const at = attribute === undefined ? restPathOf(reading, { Ref: logicalId }) : undefined;
      const owner = intrinsicOf(resource.properties['RestApiId']);
      const api = owner?.[0] === 'Ref' && typeof owner[1] === 'string' ? reading.template.resources.get(owner[1]) : undefined;
      if (at === undefined || !('path' in at) || api === undefined || !API_TYPES.rest.has(api.type)) return undefined;
      const of = apiOf(reading, api, 'rest');
      return { kind: 'rest', ...(of.name === undefined ? {} : { name: of.name }), address: of.address, path: at.path };
    }
    const kind = API_TYPES.rest.has(resource.type) ? 'rest' : API_TYPES.http.has(resource.type) ? 'http' : undefined;
    if (kind === undefined) return undefined;
    const of = apiOf(reading, resource, kind);
    return { kind, ...(of.name === undefined ? {} : { name: of.name }), address: of.address, ...(point === undefined || (kind === 'http' && attribute !== undefined) ? {} : { path: point }) };
  };

/** Every route a template writes on its APIs rather than on its functions' events. */
export const readApis = (reading: TemplateReading): void => {
  for (const resource of reading.template.resources.values()) {
    if (resource.type === 'AWS::Serverless::Api' || resource.type === 'AWS::ApiGateway::RestApi') readBody(reading, resource, 'rest');
    else if (resource.type === 'AWS::Serverless::HttpApi') readBody(reading, resource, 'http');
    else if (resource.type === 'AWS::ApiGatewayV2::Api') {
      if (textOf(resource.properties['ProtocolType']) !== 'WEBSOCKET') readBody(reading, resource, 'http');
      if (resource.properties['Target'] !== undefined) readQuickCreate(reading, resource);
    } else if (resource.type === 'AWS::ApiGatewayV2::Route') readV2Route(reading, resource);
    else if (resource.type === 'AWS::ApiGateway::Method') readRestMethod(reading, resource);
  }
};
