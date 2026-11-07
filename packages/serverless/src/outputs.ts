import { exportKey, stackOutputKey, type PathStep } from '@flowatlas/core';
import { intrinsicOf } from './cloudformation.js';
import type { FileReading } from './reading.js';
import { Imported, isRecord, textOf, Unread } from './variables.js';

/**
 * A stack's outputs, as the values it publishes for other stacks to read
 * (P249).
 *
 * CloudFormation shares a value between two stacks by writing it out: an
 * output, exported under a name (`Fn::ImportValue` reads it back), or read by
 * the stack's own name and the output's (`${cf:stack.Output}`). Each output is
 * one export under every key the files settle, naming what its value names -
 * a queue, a function's address, an API - so the linker can join it to every
 * place another repository imports it. An output that is an API's id, its
 * root or one of its resources also publishes that point, for the routes other
 * deployments hang from it (P21's roots).
 *
 * Nothing here is particular to the reader that calls it but which logical ids
 * are APIs, which the caller says: the framework's `ApiGatewayRestApi`, a SAM
 * template's `AWS::Serverless::Api`.
 */

/** An API an output's value is, or is a point of. */
export interface OutputApi {
  readonly kind: 'rest' | 'http';
  /** Its name, when read. */
  readonly name?: string;
  /** Where it is declared, for a person and for an API with no name. */
  readonly address: string;
  /** The point of it the value is - `/` for its id or its root, a resource's path - or absent for its address. */
  readonly path?: string;
}

/** What an API a value refers to is, by the logical id and attribute it refers to it by. */
export type ApiReference = (logicalId: string, attribute: string | undefined) => OutputApi | undefined;

/** An output a reader knows of that the template does not write: the framework's own `ServiceEndpoint`. */
export interface ImplicitOutput {
  readonly name: string;
  readonly api: OutputApi;
  /** The name it is exported under. */
  readonly exportName?: string;
  /** What in the file it stands for, for its line: the first route on the API. */
  readonly path: readonly PathStep[];
}

export interface OutputsOptions {
  /** Where the outputs are in the file: `resources.Outputs`, `Outputs`. */
  readonly at: readonly PathStep[];
  /** Put before every address, as the template's resources are. */
  readonly scope?: string;
  /** The stack's name, when the files settle it: every output is read by it too. */
  readonly stackName?: string;
  readonly apiOf: ApiReference;
  readonly implicit?: readonly ImplicitOutput[];
}

/** Every logical id a value refers to, with the attribute it refers to: `Ref`, `Fn::GetAtt`, a `${...}` in `Fn::Sub`, through `Fn::Join`. */
const referencesOf = (value: unknown, depth = 0): [string, string | undefined][] => {
  if (depth > 16) return [];
  const intrinsic = intrinsicOf(value);
  if (intrinsic === undefined) return Array.isArray(value) ? value.flatMap((item) => referencesOf(item, depth + 1)) : [];
  const [fn, argument] = intrinsic;
  if (fn === 'Ref' && typeof argument === 'string') return argument.startsWith('AWS::') ? [] : [[argument, undefined]];
  if (fn === 'Fn::GetAtt') {
    if (Array.isArray(argument) && typeof argument[0] === 'string') return [[argument[0], typeof argument[1] === 'string' ? argument[1] : undefined]];
    if (typeof argument === 'string') {
      const dot = argument.indexOf('.');
      return [[dot < 0 ? argument : argument.slice(0, dot), dot < 0 ? undefined : argument.slice(dot + 1)]];
    }
    return [];
  }
  if (fn === 'Fn::Sub') {
    const [template, variables] = Array.isArray(argument) ? [argument[0], argument[1]] : [argument, undefined];
    const own = isRecord(variables) ? Object.values(variables).flatMap((item) => referencesOf(item, depth + 1)) : [];
    const written = typeof template === 'string' ? [...template.matchAll(/\$\{([^}!]+)\}/g)].map((match) => match[1] as string) : [];
    return [
      ...own,
      ...written
        .filter((inside) => !inside.startsWith('AWS::') && !(isRecord(variables) && inside in variables))
        .map((inside): [string, string | undefined] => {
          const dot = inside.indexOf('.');
          return dot < 0 ? [inside, undefined] : [inside.slice(0, dot), inside.slice(dot + 1)];
        }),
    ];
  }
  if (fn === 'Fn::Join' && Array.isArray(argument)) return referencesOf(argument[1], depth + 1);
  return [];
};

/**
 * The API a value is: a `Ref` or `Fn::GetAtt` of one is a point of it the
 * caller places; a text built around one - its URL - is its address.
 */
const apiOfValue = (value: unknown, apiOf: ApiReference): OutputApi | undefined => {
  const direct = intrinsicOf(value);
  const references = referencesOf(value);
  const apis = references.map(([logicalId, attribute]) => apiOf(logicalId, attribute)).filter((api): api is OutputApi => api !== undefined);
  const [first] = apis;
  if (first === undefined || apis.some((api) => api.address !== first.address)) return undefined;
  const whole = direct !== undefined && (direct[0] === 'Ref' || direct[0] === 'Fn::GetAtt');
  return whole ? first : { kind: first.kind, ...(first.name === undefined ? {} : { name: first.name }), address: first.address };
};

/** Reads a stack's outputs into the deployment's exports and published roots. */
export const readOutputs = (reading: FileReading, written: unknown, options: OutputsOptions): void => {
  const outputs = isRecord(written) ? written : {};
  const scope = options.scope ?? '';
  for (const [name, output] of Object.entries(outputs)) {
    if (!isRecord(output)) continue;
    const path = [...options.at, name];
    const exported = isRecord(output['Export']) ? output['Export']['Name'] : undefined;
    const exportName = exported === undefined ? undefined : reading.template.text(exported);
    const keys = [
      ...(typeof exportName === 'string' ? [exportKey(exportName)] : []),
      ...(options.stackName === undefined ? [] : [stackOutputKey(options.stackName, name)]),
    ];
    if (keys.length === 0) continue;
    const address = `${scope}${[...options.at, name].join('.')}`;
    const site = reading.siteOf(path);
    const value = output['Value'];
    const api = apiOfValue(value, options.apiOf);
    if (api !== undefined) {
      publishApi(reading, { keys, address, site, api });
      continue;
    }
    const found = reading.template.deployedOf(value);
    if (found !== undefined && !(found instanceof Unread)) {
      reading.generatedRow(found, path);
      reading.parts.exports.push({ keys, address, ...site, names: { kind: found.kind, name: found.name } });
      continue;
    }
    const text = found === undefined ? reading.template.text(value) : found;
    if (typeof text === 'string') {
      reading.parts.exports.push({ keys, address, ...site, text });
      continue;
    }
    const why = text instanceof Imported ? `it is itself a value another stack publishes (${text.key})` : text.text;
    reading.parts.exports.push({ keys, address, ...site, unread: why });
  }
  for (const implicit of options.implicit ?? []) {
    if (Object.hasOwn(outputs, implicit.name)) continue;
    const keys = [
      ...(implicit.exportName === undefined ? [] : [exportKey(implicit.exportName)]),
      ...(options.stackName === undefined ? [] : [stackOutputKey(options.stackName, implicit.name)]),
    ];
    if (keys.length === 0) continue;
    publishApi(reading, { keys, address: `${scope}Outputs.${implicit.name}`, site: reading.siteOf(implicit.path), api: implicit.api });
  }
};

/** An output that is an API, or a point of one: an export naming it, and a root for each key where it is a point. */
const publishApi = (
  reading: FileReading,
  published: { readonly keys: readonly string[]; readonly address: string; readonly site: { file: string; line: number }; readonly api: OutputApi },
): void => {
  const { keys, address, site, api } = published;
  reading.parts.exports.push({ keys, address, ...site, names: { kind: 'api', name: api.name ?? api.address } });
  if (api.path === undefined) return;
  for (const key of keys) reading.parts.roots.push({ key, path: api.path, ...(api.name === undefined ? {} : { api: api.name }), ...site });
};
