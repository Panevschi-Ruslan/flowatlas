import { join, posix } from 'node:path';
import { destinationOf } from '@flowatlas/aws';
import { type DeployedFunction, type DeployedHandler, type DeployedSetting, type PathStep, type PositionedDocument } from '@flowatlas/core';
import { intrinsicOf, Template, type Deployed } from './cloudformation.js';
import { readServiceFile, ServiceFileUnreadable } from './document.js';
import { readEvent, readFunctionUrl, type Apis, type EventReading, type EventSite } from './events.js';
import { FileReading, type DeploymentParts } from './reading.js';
import { readResources } from './resources.js';
import { readPluginStateMachines, readStateMachineResource } from './state-machines.js';
import { isRecord, textOf, Unread, Variables, type StageFrom } from './variables.js';

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
  const variables = new Variables({ document: document.value, dir: join(repoDir, dir), options: options.options, loaded: options.loaded });
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
  const apis: Apis = {
    ...(service === undefined || stageText === undefined
      ? {}
      : {
          rest: textOf(provider['apiName']) ?? `${stageText}-${service}`,
          http: (isRecord(provider['httpApi']) ? textOf(provider['httpApi']['name']) : undefined) ?? `${stageText}-${service}`,
          socket: textOf(provider['websocketsApiName']) ?? `${stageText}-${service}-websockets`,
        }),
  };
  const events: EventReading = { file: reading, apis };

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

  if (resolved['constructs'] !== undefined) {
    reading.row(['constructs'], 'constructs', {
      reason: 'deployment-plugin-unread',
      message: `${file} declares constructs, which a plugin turns into functions, queues and routes, and which are not read`,
      hint: 'Declare them under functions and resources, or expect them missing from the map.',
    });
  }
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
    environment[variable] = reading.settingOf(own[variable] ?? declaration.providerEnvironment[variable]);
  }
  const deployed: DeployedFunction = {
    ...at,
    ...(typeof name === 'string' ? { name } : {}),
    address,
    ...(handler === undefined ? {} : { handler }),
    ...(runtime === undefined ? {} : { runtime }),
    environment,
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
    const what = `the ${when} destination of ${address}`;
    const to = destinationOf(reading.targetOf(found, [...path, key], `${address}.destinations.${key}`, what), when);
    reading.parts.deliveries.push({
      ...reading.siteOf([...path, key]),
      address: `${address}.destinations.${key}`,
      by: 'destination',
      from: { kind: 'outcome', when, of: { function: index } },
      ...(to === undefined ? {} : { to }),
      meta: { when },
    });
  }
};
