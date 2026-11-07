import { posix } from 'node:path';
import { destinationOf } from '@flowatlas/aws';
import type { DeployedFunction, DeployedHandler, DeployedSetting, PathStep } from '@flowatlas/core';
import { isRecord, pushFunctionUrl, textOf, Unread, type Resource } from '@flowatlas/serverless';
import type { DeclaredFunction, TemplateReading } from './reading.js';

/**
 * The functions a template declares (P246): `AWS::Serverless::Function`, with
 * `Globals.Function` merged under it as the transform merges it, and a plain
 * `AWS::Lambda::Function` beside it. Each is the function Terraform's reading
 * of the same deployment has - a name, a handler in a directory, a runtime, the
 * values it is deployed with - so the adapter draws it unchanged.
 */

/** The types of function a template declares, and the property each keeps its handler's code under. */
export const FUNCTION_TYPES = new Set(['AWS::Serverless::Function', 'AWS::Lambda::Function']);

/**
 * `Globals` under a resource's own properties: a mapping merged member by
 * member, a list the globals' items first, and anything else the resource's
 * own where it has one - the transform's rule.
 */
export const withGlobals = (globals: unknown, own: Record<string, unknown>): Record<string, unknown> => {
  if (!isRecord(globals)) return own;
  const out: Record<string, unknown> = { ...globals };
  for (const [key, value] of Object.entries(own)) {
    const global = out[key];
    if (isRecord(global) && isRecord(value)) out[key] = withGlobals(global, value);
    else if (Array.isArray(global) && Array.isArray(value)) out[key] = [...global, ...value];
    else out[key] = value;
  }
  return out;
};

/** A local directory a property names, repo-relative; `undefined` for an S3 location or an image. */
const localDirectory = (reading: TemplateReading, written: unknown): string | undefined => {
  const text = textOf(written);
  if (text === undefined || /^s3:\/\//.test(text) || /^https?:/.test(text)) return undefined;
  const joined = posix.normalize(posix.join(reading.dir, text));
  return joined.replace(/\/$/, '') || '.';
};

/** Where the code of a function is: a directory, an archive somewhere else, inline, or an image. */
type CodeAt = { readonly directory?: string } | { readonly inline: true } | { readonly image: true };

const codeOf = (reading: TemplateReading, resource: Resource, properties: Record<string, unknown>): CodeAt => {
  if (textOf(properties['PackageType']) === 'Image' || properties['ImageUri'] !== undefined) return { image: true };
  if (resource.type === 'AWS::Serverless::Function') {
    if (properties['InlineCode'] !== undefined) return { inline: true };
    const uri = properties['CodeUri'];
    if (uri === undefined) return { directory: reading.dir };
    const directory = localDirectory(reading, uri);
    return directory === undefined ? {} : { directory };
  }
  const code = properties['Code'];
  if (isRecord(code)) {
    if (code['ZipFile'] !== undefined) return { inline: true };
    if (code['ImageUri'] !== undefined) return { image: true };
    return {};
  }
  // `aws cloudformation package` takes a local directory here.
  const directory = localDirectory(reading, code);
  return directory === undefined ? {} : { directory };
};

/**
 * The entry points of a function built with esbuild (`Metadata.BuildMethod`).
 * The handler then names the bundle, which takes its name from its entry
 * point; the entry point is the source, so it is the module the handler is in.
 */
const entryPointsOf = (metadata: unknown): string[] => {
  if (!isRecord(metadata) || textOf(metadata['BuildMethod']) !== 'esbuild' || !isRecord(metadata['BuildProperties'])) return [];
  const points = metadata['BuildProperties']['EntryPoints'];
  return Array.isArray(points) ? points.filter((point): point is string => typeof point === 'string') : [];
};

export interface FunctionSite {
  readonly fn: DeclaredFunction;
  readonly properties: Record<string, unknown>;
  /** The resource as written, for `Metadata`. */
  readonly written: Record<string, unknown>;
}

/** The handler, or a row saying why there is none to point at. */
const handlerOf = (reading: TemplateReading, site: FunctionSite, code: CodeAt): DeployedHandler | undefined => {
  const { resource } = site.fn;
  const path = [...resource.path, 'Properties', 'Handler'];
  const row = (message: string, hint: string): undefined => {
    reading.file.row(path, resource.address, { reason: 'function-handler-unread', message, hint });
    return undefined;
  };
  if ('inline' in code) return row(`${resource.address} is written inline in the template, so there is no module to point at`, 'Move the code into a file and name it with CodeUri and Handler.');
  const written = site.properties['Handler'];
  const text = textOf(written);
  if (text === undefined) {
    return row(`the handler of ${resource.address} is not read${written instanceof Unread ? `: ${written.text}` : ''}`, 'Write the Handler as a string the template settles, such as "app.handler".');
  }
  const dot = text.lastIndexOf('.');
  if (dot <= 0 || dot === text.length - 1) {
    return row(`the handler of ${resource.address} is ${JSON.stringify(text)}, which does not say a module and an export`, 'A Node.js handler is written "<module>.<export>", such as "app.handler".');
  }
  let module = text.slice(0, dot);
  // esbuild names the bundle after its entry point, so the entry point whose
  // name the handler's module has is the source the handler is in.
  const entry = entryPointsOf(site.written['Metadata']).find((point) => posix.basename(point).replace(/\.[cm]?[jt]sx?$/, '') === posix.basename(module));
  if (entry !== undefined) module = entry.replace(/^\.\//, '').replace(/\.[cm]?[jt]sx?$/, '');
  return {
    written: text,
    module,
    export: text.slice(dot + 1),
    ...('directory' in code && code.directory !== undefined ? { directory: code.directory, directoryFrom: `${resource.address}.${resource.type === 'AWS::Serverless::Function' ? 'CodeUri' : 'Code'}` } : {}),
  };
};

/** One function: its name, its handler, its runtime and the values it is deployed with. */
export const readFunction = (reading: TemplateReading, site: FunctionSite): void => {
  const { fn, properties } = site;
  const { resource } = fn;
  const path = resource.path;
  const label = typeof fn.name === 'string' && !fn.generated ? fn.name : resource.address;
  if (fn.name instanceof Unread) {
    const variable = fn.name.variable;
    reading.file.row([...path, 'Properties', 'FunctionName'], resource.address, {
      reason: 'function-name-unread',
      message: `the name of ${resource.address} is not read: ${fn.name.text}`,
      hint:
        variable === undefined
          ? 'Nothing can join to a function whose name is not read. Write the FunctionName so the template settles it, or leave it out and let the platform name it.'
          : `Give the parameter ${variable} a Default, a value in samconfig.toml's parameter_overrides, or one under services[].infra.options.`,
      meta: variable === undefined ? {} : { variable },
    });
  }
  const code = codeOf(reading, resource, properties);
  const runtime = textOf(properties['Runtime']);
  if ('image' in code) {
    reading.file.row(path, resource.address, {
      reason: 'function-image-unread',
      level: 'info',
      message: `${label} is deployed as a container image, whose handler is set inside the image`,
      hint: 'The function is in the graph under its name; the code it runs is not pointed at.',
    });
  } else if (runtime !== undefined && !runtime.startsWith('nodejs')) {
    reading.file.row(path, resource.address, {
      reason: 'function-runtime-unread',
      level: 'info',
      message: `${label} runs on ${runtime}; only Node.js handlers are read, so its body is not`,
      hint: 'The function is still in the graph under its name, and whatever invokes it still joins to it.',
    });
  }
  // A handler of another language, or inside an image, is said once, by its row.
  const handler = 'image' in code || (runtime !== undefined && !runtime.startsWith('nodejs')) ? undefined : handlerOf(reading, site, code);
  const environment: Record<string, DeployedSetting> = {};
  const variables = isRecord(properties['Environment']) ? properties['Environment']['Variables'] : undefined;
  if (isRecord(variables)) for (const name of Object.keys(variables).sort()) environment[name] = reading.file.settingOf(variables[name], [...path, 'Properties', 'Environment', 'Variables', name], `the value of ${name} ${resource.address} is deployed with`);
  const deployed: DeployedFunction = {
    ...reading.file.siteOf(path),
    ...(typeof fn.name === 'string' && !fn.generated ? { name: fn.name } : {}),
    address: resource.address,
    ...(handler === undefined ? {} : { handler }),
    ...(runtime === undefined ? {} : { runtime }),
    environment,
    meta: {
      declaredAs: resource.address,
      logicalId: resource.logicalId,
      ...(fn.generated ? { nameGenerated: true } : {}),
      ...(fn.name instanceof Unread ? { nameUnread: fn.name.text } : {}),
      ...reading.conditionOf(resource.logicalId),
    },
  };
  if (fn.generated) reading.file.generatedRow({ kind: 'function', name: fn.name as string, generated: true }, path);
  reading.file.parts.functions.push(deployed);
};

/** The function as a deployed thing, for a route or a delivery that names it. */
export const deployedFunction = (fn: DeclaredFunction) => ({
  kind: 'function' as const,
  name: typeof fn.name === 'string' ? fn.name : fn.resource.address,
  function: fn.index,
});

/** `FunctionUrlConfig`: the function's own address, every verb and every path (P53). */
export const readFunctionUrlConfig = (reading: TemplateReading, site: FunctionSite): void => {
  const config = site.properties['FunctionUrlConfig'];
  if (!isRecord(config)) return;
  const { resource } = site.fn;
  pushFunctionUrl(reading.file, [...resource.path, 'Properties', 'FunctionUrlConfig'], `${resource.address}.FunctionUrlConfig`, deployedFunction(site.fn), textOf(config['AuthType']));
};

/**
 * Where a function's runs are handed on (P54): `EventInvokeConfig` on a SAM
 * function, and the older dead-letter queue or topic its failed asynchronous
 * runs go to, which is a destination for failure by another name.
 */
export const readDestinations = (reading: TemplateReading, site: FunctionSite): void => {
  const { fn, properties } = site;
  const { resource } = fn;
  const push = (when: 'success' | 'failure', target: unknown, path: PathStep[], address: string): void => {
    const to = destinationOf(reading.targetOf(reading.deployedOf(target), path, address, `the ${when} destination of ${resource.address}`), when);
    reading.file.parts.deliveries.push({
      ...reading.file.siteOf(path),
      address,
      by: 'destination',
      from: { kind: 'outcome', when, of: { function: fn.index } },
      ...(to === undefined ? {} : { to }),
      meta: { when, ...reading.conditionOf(resource.logicalId) },
    });
  };
  const invoke = isRecord(properties['EventInvokeConfig']) ? properties['EventInvokeConfig']['DestinationConfig'] : undefined;
  if (isRecord(invoke)) {
    for (const [key, when] of [
      ['OnSuccess', 'success'],
      ['OnFailure', 'failure'],
    ] as const) {
      const written = invoke[key];
      if (!isRecord(written)) continue;
      push(when, written['Destination'], [...resource.path, 'Properties', 'EventInvokeConfig', 'DestinationConfig', key], `${resource.address}.EventInvokeConfig.${key}`);
    }
  }
  const deadLetter = resource.type === 'AWS::Serverless::Function' ? properties['DeadLetterQueue'] : properties['DeadLetterConfig'];
  if (isRecord(deadLetter)) {
    const key = resource.type === 'AWS::Serverless::Function' ? 'DeadLetterQueue' : 'DeadLetterConfig';
    push('failure', deadLetter['TargetArn'], [...resource.path, 'Properties', key], `${resource.address}.${key}`);
  }
};
