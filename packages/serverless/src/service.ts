import { join, posix } from 'node:path';
import { destinationOf, executeApiAddress, executeApiServedAt } from '@flowatlas/aws';
import { type DeployedFunction, type DeployedHandler, type DeployedKind, type DeployedSetting, type PathStep, type PositionedDocument } from '@flowatlas/core';
import { intrinsicOf, Template, type Deployed } from './cloudformation.js';
import { readServiceFile, ServiceFileUnreadable } from './document.js';
import { serviceFunctionGrants } from './grants.js';
import { readEvent, readFunctionUrl, type Apis, type EventReading, type EventSite, type SharedApi } from './events.js';
import { readOutputs, readParameters, type ApiReference, type ImplicitOutput } from './outputs.js';
import { FileReading, type DeploymentParts } from './reading.js';
import { DESTINATION_KINDS, readResources } from './resources.js';
import { readPluginStateMachines, readStateMachineResource } from './state-machines.js';
import { DEFAULT_REGION, Imported, isRecord, textOf, Unread, Variables, type StageFrom } from './variables.js';

/**
 * One service file, read into the parts of a deployment (P57).
 *
 * The file is read as a document, its variables resolved, and then read in
 * the order the framework builds a stack: the functions it declares, under the
 * names the framework gives them; the events each is run by; the resources
 * written beside them; the state machines of the step-functions plugin. Every
 * part is the shape Terraform's reading of the same deployment has, so the
 * adapter, the linker and every command after them read it unchanged.
 */

/** The framework's spelling of a function's key inside a logical id: `place-order` is `PlaceDashorder`. */
export const normalizedName = (name: string): string => {
  const replaced = name.replace(/-/g, 'Dash').replace(/_/g, 'Underscore');
  return replaced.charAt(0).toUpperCase() + replaced.slice(1);
};

/** The logical id the framework gives a function it creates. */
export const functionLogicalId = (key: string): string => `${normalizedName(key)}LambdaFunction`;

/** The logical id the step-functions plugin gives a state machine. */
const stateMachineLogicalId = (key: string, machine: Record<string, unknown>): string => {
  const id = textOf(machine['id']);
  if (id !== undefined) return id;
  const name = textOf(machine['name']);
  return name !== undefined ? normalizedName(name.replace(/[^0-9A-Za-z]/g, '')) : `${normalizedName(key)}StepFunctionsStateMachine`;
};

/**
 * The API of this service an address written out is one of, and the path it
 * asks for there (P268): `https://<id>.execute-api.<region>.amazonaws.com/<stage>/<path>`
 * in the service's region, at the stage it is deployed to, is its REST API
 * where its functions declare `http` events, and one with no stage its HTTP
 * API's default stage where they declare `httpApi`. The id is a value the
 * platform assigns once the API is created and is not read: an address of
 * another API of the same region and stage would read the same, which the
 * linker says on the request it joins.
 */
const ownApiOf = (
  functions: readonly (readonly [string, Record<string, unknown>])[],
  apis: Apis,
  stage: string | undefined,
  region: string | undefined,
): ((text: string) => { name: string; path: string } | undefined) => {
  const declares = (kind: string): boolean =>
    functions.some(([, fn]) => Array.isArray(fn['events']) && fn['events'].some((event) => isRecord(event) && event[kind] !== undefined));
  const rest = apis.sharedRest === undefined && declares('http') ? apis.rest : undefined;
  const http = apis.sharedHttp === undefined && declares('httpApi') ? apis.http : undefined;
  return (text) => {
    const address = executeApiAddress(text);
    if (address === undefined || (region !== undefined && address.region !== region)) return undefined;
    const [first, ...after] = address.segments;
    if (rest !== undefined && stage !== undefined && first === stage) return { name: rest, path: `/${after.join('/')}` };
    if (http !== undefined && first !== stage) return { name: http, path: `/${address.segments.join('/')}` };
    return undefined;
  };
};

/** `functions` as one mapping, written as one or as a list of them. */
const functionsOf = (value: unknown): [string, Record<string, unknown>][] => {
  const maps = Array.isArray(value) ? value : [value];
  return maps.flatMap((map) => (isRecord(map) ? Object.entries(map).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])) : []));
};

export interface ServiceOptions {
  /** Absolute path of the repository. */
  readonly repoDir: string;
  /** Repo-relative path of the service file. */
  readonly file: string;
  /** What the deployment is run with (`services[].infra.options`). */
  readonly options: Readonly<Record<string, string>>;
  /** Absolute paths of every file a variable loaded, filled as they are. */
  readonly loaded: Set<string>;
  /** What a composition of services hands this one as its params (P249). */
  readonly params?: Readonly<Record<string, unknown>>;
}

export const readService = (parts: DeploymentParts, options: ServiceOptions): void => {
  const { repoDir, file } = options;
  let document: PositionedDocument;
  try {
    document = readServiceFile(join(repoDir, file));
  } catch (cause) {
    parts.rows.push({
      file,
      line: cause instanceof ServiceFileUnreadable ? cause.line : 1,
      reason: 'infra-file-unparsed',
      message: `${file} is not read: ${cause instanceof Error ? cause.message : String(cause)}`,
      hint: 'Nothing in this service file is read. If it is valid, this is a defect in the reader: report it with the line.',
    });
    return;
  }
  const dir = posix.dirname(file);
  const variables = new Variables({
    document: document.value,
    dir: join(repoDir, dir),
    options: options.options,
    loaded: options.loaded,
    ...(options.params === undefined ? {} : { params: options.params }),
  });
  const resolved = variables.at([]);
  if (!isRecord(resolved)) return;
  const provider = isRecord(resolved['provider']) ? resolved['provider'] : {};
  const providerName = textOf(provider['name']);
  if (providerName !== undefined && providerName !== 'aws') {
    parts.rows.push({
      file,
      line: document.at(['provider', 'name'])?.line ?? 1,
      reason: 'deployment-unread',
      level: 'info',
      message: `${file} deploys to ${providerName}, and only AWS is read`,
      hint: 'Nothing in this service file is read.',
    });
    return;
  }

  const serviceWritten = isRecord(resolved['service']) ? resolved['service']['name'] : resolved['service'];
  const service = textOf(serviceWritten);
  const stage = variables.stage;
  const stageText = textOf(stage.value);
  const functions = functionsOf(resolved['functions']);
  const base = parts.functions.length;
  const functionIndex = new Map<string, number>();
  functions.forEach(([key], index) => functionIndex.set(key, base + index));
  const logicalIds = new Map<string, string>(functions.map(([key]) => [functionLogicalId(key), key]));
  const machines = isRecord(resolved['stepFunctions']) && isRecord(resolved['stepFunctions']['stateMachines']) ? resolved['stepFunctions']['stateMachines'] : {};

  // Names first, because one function's events and destinations name another.
  const names = functions.map(([key, fn]): string | Unread => {
    const written = fn['name'];
    if (written !== undefined) return textOf(written) ?? (written instanceof Unread ? written : new Unread('the name is not text'));
    if (service === undefined) return new Unread(`the service's name is not read`, serviceWritten instanceof Unread ? serviceWritten.variable : undefined);
    if (stageText === undefined) return new Unread(`the stage is not read: ${(stage.value as Unread).text}`, (stage.value as Unread).variable);
    return `${service}-${stageText}-${key}`;
  });

  const template = new Template(
    isRecord(resolved['resources']) ? resolved['resources']['Resources'] : undefined,
    (logicalId) => {
      // A function by its logical id, or - asked by `functionNamed`, behind a
      // NUL no logical id holds - by its key.
      const key = logicalId.startsWith('\u0000') ? logicalId.slice(1) : logicalIds.get(logicalId);
      const index = key === undefined ? undefined : functionIndex.get(key);
      if (index !== undefined) {
        const name = names[index - base] as string | Unread;
        return typeof name === 'string' ? { kind: 'function', name, function: index } : name;
      }
      // A function's URL, which the framework declares as `<function>Url`: the
      // function's own address, named by the function (P54, P246).
      const url = logicalId.endsWith('Url') ? logicalIds.get(logicalId.slice(0, -'Url'.length)) : undefined;
      const urlIndex = url === undefined ? undefined : functionIndex.get(url);
      if (urlIndex !== undefined) {
        const name = names[urlIndex - base] as string | Unread;
        return typeof name === 'string' ? { kind: 'url', name } : name;
      }
      for (const [machineKey, machine] of Object.entries(machines)) {
        if (!isRecord(machine) || stateMachineLogicalId(machineKey, machine) !== logicalId) continue;
        const name = textOf(machine['name']);
        return name === undefined ? undefined : { kind: 'workflow', name };
      }
      return undefined;
    },
    {
      ...(textOf(provider['region']) === undefined ? {} : { region: textOf(provider['region']) as string }),
      ...(service === undefined || stageText === undefined ? {} : { stackName: textOf(provider['stackName']) ?? `${service}-${stageText}` }),
    },
    file,
  );
  const reading = new FileReading(parts, file, document, template, functionIndex);
  // An API another deployment creates, which this service's routes hang from (P249).
  // Routes hang from the root resource the service is given, where it is given one, else from the API's own (P253).
  const gateway = isRecord(provider['apiGateway']) ? provider['apiGateway'] : {};
  const sharedRest = gateway['restApiId'] === undefined ? undefined : sharedApiOf(template, gateway['restApiRootResourceId'] ?? gateway['restApiId']);
  const sharedHttp = sharedApiOf(template, isRecord(provider['httpApi']) ? provider['httpApi']['id'] : undefined);
  const apis: Apis = {
    ...(service === undefined || stageText === undefined
      ? {}
      : {
          rest: textOf(provider['apiName']) ?? `${stageText}-${service}`,
          http: (isRecord(provider['httpApi']) ? textOf(provider['httpApi']['name']) : undefined) ?? `${stageText}-${service}`,
          socket: textOf(provider['websocketsApiName']) ?? `${stageText}-${service}-websockets`,
        }),
    ...(sharedRest === undefined ? {} : { sharedRest }),
    ...(sharedHttp === undefined ? {} : { sharedHttp }),
  };
  // Where the service's own APIs are served (P284): in its region, any where
  // it is not read (P294), the REST API under its stage and the HTTP API at
  // its default stage, which writes none. The stage the file gives - written
  // out, `${opt:stage, ...}`, or none - is the one deployed to where nothing
  // chooses, and `--stage` chooses any (P294); only the configuration's
  // options settle it.
  const region = textOf(provider['region']) ?? (provider['region'] === undefined ? DEFAULT_REGION : undefined);
  const chosen = stage.from !== 'option';
  const served =
    stageText === undefined
      ? undefined
      : {
          ...(apis.rest === undefined ? {} : { rest: executeApiServedAt(region, apis.rest, { name: stageText, chosen }) }),
          ...(apis.http === undefined ? {} : { http: executeApiServedAt(region, apis.http, {}) }),
        };
  const events: EventReading = { file: reading, apis: served === undefined ? apis : { ...apis, served } };
  reading.ownApi = ownApiOf(functions, apis, stageText, textOf(provider['region']));

  const providerEnvironment = isRecord(provider['environment']) ? provider['environment'] : {};
  const packaged = isRecord(resolved['package']) ? resolved['package'] : {};
  functions.forEach(([key, fn], offset) => {
    const index = parts.functions.length;
    const path: PathStep[] = ['functions', key];
    const address = `functions.${key}`;
    const name = names[offset] as string | Unread;
    readFunction(reading, { key, fn, index, path, address, name, stageFrom: stage.from, provider, providerEnvironment, packaged });
    const site = (inner: PathStep[], innerAddress: string): EventSite => ({
      key,
      index,
      ...(typeof name === 'string' ? { name } : {}),
      path: inner,
      address: innerAddress,
    });
    const list = Array.isArray(fn['events']) ? fn['events'] : [];
    list.forEach((event, at) => readEvent(event, site([...path, 'events', at], `${address}.events[${at}]`), events));
    readFunctionUrl(fn['url'], site([...path, 'url'], `${address}.url`), events);
    readDestinations(reading, fn['destinations'], index, [...path, 'destinations'], address);
  });

  readResources(reading);
  for (const resource of template.ofType('AWS::StepFunctions::StateMachine')) readStateMachineResource(reading, resource);
  readPluginStateMachines(reading, machines);
  readServiceOutputs(reading, resolved, { apis, stackName: service === undefined || stageText === undefined ? undefined : (textOf(provider['stackName']) ?? `${service}-${stageText}`), service, stage: stageText });

  if (resolved['constructs'] !== undefined) {
    reading.row(['constructs'], 'constructs', {
      reason: 'deployment-plugin-unread',
      message: `${file} declares constructs, which a plugin turns into functions, queues and routes, and which are not read`,
      hint: 'Declare them under functions and resources, or expect them missing from the map.',
    });
  }
};

/**
 * The API another deployment creates that a service's routes hang from, by
 * the output its id is read from (P249); `undefined` where the service makes
 * its own.
 */
const sharedApiOf = (template: Template, value: unknown): SharedApi | undefined => {
  if (value === undefined || value === null) return undefined;
  const found = value instanceof Unread ? value : template.deployedOf(value);
  if (found instanceof Imported) return { root: found.key };
  if (found instanceof Unread) return { unread: `its id is not read: ${found.text}` };
  const text = textOf(value);
  return { unread: text === undefined ? 'its id is not read' : `its id is written as ${text}, which no deployment publishes under a name to join by` };
};

/** What the framework writes out of a service's own, beside `resources.Outputs`, and what each is. */
const readServiceOutputs = (
  reading: FileReading,
  resolved: Record<string, unknown>,
  service: { readonly apis: Apis; readonly stackName: string | undefined; readonly service: string | undefined; readonly stage: string | undefined },
): void => {
  const { apis } = service;
  const rest = apis.sharedRest === undefined && apis.rest !== undefined ? { kind: 'rest' as const, name: apis.rest, address: `${reading.file}#rest-api` } : undefined;
  const http = apis.sharedHttp === undefined && apis.http !== undefined ? { kind: 'http' as const, name: apis.http, address: `${reading.file}#http-api` } : undefined;
  const routed = (address: string): boolean => reading.parts.routes.some((route) => route.meta?.['apiAddress'] === address);
  // The framework's own outputs, where it creates the API they describe:
  // `ServiceEndpoint`, exported as `sls-<service>-<stage>-ServiceEndpoint`, and the HTTP API's id and URL.
  const implicit: ImplicitOutput[] = [
    ...(rest !== undefined && routed(rest.address)
      ? [{ name: 'ServiceEndpoint', api: rest, path: ['provider'], ...(service.service === undefined || service.stage === undefined ? {} : { exportName: `sls-${service.service}-${service.stage}-ServiceEndpoint` }) }]
      : []),
    ...(http !== undefined && routed(http.address)
      ? [
          { name: 'HttpApiId', api: { ...http, path: '/' }, path: ['provider'] },
          { name: 'HttpApiUrl', api: http, path: ['provider'] },
        ]
      : []),
  ];
  const resources = isRecord(resolved['resources']) ? resolved['resources'] : {};
  const apiOf: ApiReference = (logicalId, attribute) => {
    if (logicalId === 'ApiGatewayRestApi' && rest !== undefined) return attribute === undefined || attribute === 'RootResourceId' ? { ...rest, path: '/' } : rest;
    if (logicalId === 'HttpApi' && http !== undefined) return attribute === undefined ? { ...http, path: '/' } : http;
    return undefined;
  };
  readOutputs(reading, resources['Outputs'], {
    at: ['resources', 'Outputs'],
    ...(service.stackName === undefined ? {} : { stackName: service.stackName }),
    implicit,
    apiOf,
  });
  // The parameters of the account the service writes, by their names (P253).
  readParameters(reading, { apiOf });
};

interface FunctionDeclaration {
  readonly key: string;
  readonly fn: Record<string, unknown>;
  readonly index: number;
  readonly path: PathStep[];
  readonly address: string;
  readonly name: string | Unread;
  readonly stageFrom: StageFrom;
  readonly provider: Record<string, unknown>;
  readonly providerEnvironment: Record<string, unknown>;
  readonly packaged: Record<string, unknown>;
}

/** One function: its name, its handler, its runtime and the values it is deployed with. */
const readFunction = (reading: FileReading, declaration: FunctionDeclaration): void => {
  const { fn, path, address, name } = declaration;
  const at = reading.siteOf(path);
  if (name instanceof Unread) {
    reading.row(path, address, {
      reason: 'function-name-unread',
      message: `the name of ${address} is not read: ${name.text}`,
      hint:
        name.variable === undefined
          ? 'Nothing can join to a function whose name is not read. Write the name, the service and the stage so the file settles them.'
          : `Give \${${name.variable}} a value the files settle${name.variable.startsWith('opt:') ? ', or set it under services[].infra.options' : ''}.`,
      meta: name.variable === undefined ? {} : { variable: name.variable },
    });
  }
  const runtime = textOf(fn['runtime']) ?? textOf(declaration.provider['runtime']);
  if (runtime !== undefined && !runtime.startsWith('nodejs')) {
    reading.row(path, address, {
      reason: 'function-runtime-unread',
      level: 'info',
      message: `${typeof name === 'string' ? name : address} runs on ${runtime}; only Node.js handlers are read, so its body is not`,
      hint: 'The function is still in the graph under its name, and whatever invokes it still joins to it.',
    });
  }
  // A handler of another language is said once, by the runtime's row; looking
  // for its module among the TypeScript would only add a second row about it.
  const nodeRuntime = runtime === undefined || runtime.startsWith('nodejs');
  const handler = fn['image'] !== undefined || !nodeRuntime ? undefined : handlerOf(reading, declaration);
  if (fn['image'] !== undefined) {
    reading.row(path, address, {
      reason: 'function-image-unread',
      level: 'info',
      message: `${typeof name === 'string' ? name : address} is deployed as a container image, whose handler is set inside the image`,
      hint: 'The function is in the graph under its name; the code it runs is not pointed at.',
    });
  }
  const environment: Record<string, DeployedSetting> = {};
  const own = isRecord(fn['environment']) ? fn['environment'] : {};
  for (const variable of Object.keys({ ...declaration.providerEnvironment, ...own }).sort()) {
    const inFunction = own[variable] !== undefined;
    environment[variable] = reading.settingOf(
      own[variable] ?? declaration.providerEnvironment[variable],
      inFunction ? [...path, 'environment', variable] : ['provider', 'environment', variable],
      inFunction ? `the value of ${variable} ${address} is deployed with` : `the value of ${variable} the functions of ${reading.file} are deployed with`,
    );
  }
  // What its role lets it send to (P272).
  const grants = serviceFunctionGrants(reading, fn, path, declaration.provider);
  const deployed: DeployedFunction = {
    ...at,
    ...(typeof name === 'string' ? { name } : {}),
    address,
    ...(handler === undefined ? {} : { handler }),
    ...(runtime === undefined ? {} : { runtime }),
    environment,
    ...(grants.length === 0 ? {} : { grants }),
    meta: {
      declaredAs: address,
      stageFrom: declaration.stageFrom,
      ...(name instanceof Unread ? { nameUnread: name.text } : {}),
    },
  };
  reading.parts.functions.push(deployed);
};

/** The handler string, and the directory it is relative to: the service's, unless an artifact is packaged instead. */
const handlerOf = (reading: FileReading, declaration: FunctionDeclaration): DeployedHandler | undefined => {
  const { fn, path, address } = declaration;
  const written = textOf(fn['handler']);
  if (written === undefined) {
    reading.row(path, address, {
      reason: 'function-handler-unread',
      message: `the handler of ${address} is not read${fn['handler'] instanceof Unread ? `: ${(fn['handler'] as Unread).text}` : ''}`,
      hint: 'Write the handler as a string the file settles, such as "src/handler.main".',
    });
    return undefined;
  }
  const dot = written.lastIndexOf('.');
  if (dot <= 0 || dot === written.length - 1) {
    reading.row(path, address, {
      reason: 'function-handler-unread',
      message: `the handler of ${address} is ${JSON.stringify(written)}, which does not say a module and an export`,
      hint: 'A Node.js handler is written "<module>.<export>", such as "src/handler.main".',
    });
    return undefined;
  }
  const artifact = (isRecord(fn['package']) ? fn['package']['artifact'] : undefined) ?? declaration.packaged['artifact'];
  return {
    written,
    module: written.slice(0, dot),
    export: written.slice(dot + 1),
    ...(artifact === undefined ? { directory: reading.dir, directoryFrom: reading.file } : {}),
  };
};

/** What the framework's `type` of a destination says it is. */
const DESTINATION_TYPES: Readonly<Record<string, DeployedKind>> = { sqs: 'queue', sns: 'topic', eventBus: 'bus', function: 'function' };

/** `destinations: { onSuccess, onFailure }`: where a run's result is handed on (P54). */
const readDestinations = (reading: FileReading, value: unknown, index: number, path: PathStep[], address: string): void => {
  if (!isRecord(value)) return;
  for (const [key, when] of [
    ['onSuccess', 'success'],
    ['onFailure', 'failure'],
  ] as const) {
    const written = value[key];
    if (written === undefined) continue;
    const target = isRecord(written) && intrinsicOf(written) === undefined ? written['arn'] : written;
    const text = textOf(target);
    const found: Deployed | Unread | undefined = text !== undefined && !text.startsWith('arn:') ? reading.functionNamed(text) : reading.template.deployedOf(target);
    // The object form says what the destination is, where an import's use would not (P253).
    const type = isRecord(written) ? textOf(written['type']) : undefined;
    const typed = type === undefined ? undefined : DESTINATION_TYPES[type];
    reading.deliverTo(
      { ...reading.siteOf([...path, key]), address: `${address}.destinations.${key}`, by: 'destination', from: { kind: 'outcome', when, of: { function: index } }, meta: { when } },
      found,
      [...path, key],
      `the ${when} destination of ${address}`,
      typed === undefined ? DESTINATION_KINDS : [typed],
      (to) => destinationOf(to, when),
    );
  }
};
