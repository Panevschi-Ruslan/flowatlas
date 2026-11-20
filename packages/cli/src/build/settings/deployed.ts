import { parseJsonc, readWorkerToml as readToml } from '@flowatlas/core';
import { parse } from 'yaml';
import type { Written } from './dotenv.js';

/**
 * The variables two kinds of deployment file declare for the code they run
 * (P77): a function framework's `serverless.yml` and a worker's
 * `wrangler.json` / `wrangler.jsonc` / `wrangler.toml`.
 *
 * Read for what they write out literally. A value assembled from a parameter,
 * a stage or a secret store is not a value anybody here can read, and is left
 * alone rather than guessed at.
 */

/** A variable a deployment file declares, with what it is declared for. */
export interface Declared extends Written {
  /** The function it is declared for; absent when it is for every one. */
  readonly within?: string;
  /** The environment it is declared for, when the file declares several. */
  readonly environment?: string;
}

/** A binding a worker's configuration declares to another worker (P91). */
export interface DeclaredBinding {
  readonly binding: string;
  readonly service: string;
  readonly entrypoint?: string;
  /** The environment it is declared for, when the file declares several. */
  readonly environment?: string;
}

/** What a deployment file says: its variables, and the port it is run on locally. */
export interface DeploymentSettings {
  readonly declared: readonly Declared[];
  readonly ports: readonly number[];
  /** The other workers it reaches through a binding (P91). */
  readonly bindings?: readonly DeclaredBinding[];
  /** The names it is deployed under, its own and one per environment (P91). */
  readonly names?: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A value written out: a string with no placeholder in it, or a number. */
const literal = (value: unknown): string | undefined => {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string' || value === '' || value.includes('${')) return undefined;
  return value;
};

const variables = (value: unknown, extra: Omit<Declared, 'name' | 'raw'> = {}): Declared[] =>
  isRecord(value)
    ? Object.entries(value).flatMap(([name, raw]) => {
        const text = literal(raw);
        return text === undefined ? [] : [{ name, raw: text, ...extra }];
      })
    : [];

/** `provider.environment`, for every function, and `functions.<name>.environment` for one. */
export const readServerlessFile = (text: string): DeploymentSettings => {
  let document: unknown;
  try {
    document = parse(text, { logLevel: 'silent', merge: true });
  } catch {
    return { declared: [], ports: [] };
  }
  if (!isRecord(document)) return { declared: [], ports: [] };
  const provider = document['provider'];
  const functions = document['functions'];
  return {
    declared: [
      ...variables(isRecord(provider) ? provider['environment'] : undefined),
      ...(isRecord(functions)
        ? Object.entries(functions).flatMap(([name, fn]) => variables(isRecord(fn) ? fn['environment'] : undefined, { within: name }))
        : []),
    ],
    ports: [],
  };
};

/**
 * `services: [{ binding, service, entrypoint? }]`: the workers a worker reaches
 * by name rather than by address (P91). Only bindings written out in full; one
 * whose service is assembled from a placeholder is not a name anybody can read.
 */
const bindingsIn = (value: unknown, environment?: string): DeclaredBinding[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const binding = literal(item['binding']);
        const service = literal(item['service']);
        const entrypoint = literal(item['entrypoint']);
        if (binding === undefined || service === undefined) return [];
        return [
          {
            binding,
            service,
            ...(entrypoint === undefined ? {} : { entrypoint }),
            ...(environment === undefined ? {} : { environment }),
          },
        ];
      })
    : [];

/**
 * `vars`, and `env.<name>.vars` for one environment; `dev.port` is where it
 * runs locally; `services` and `env.<name>.services` the workers it is bound
 * to, and `name` and `env.<name>.name` what it is deployed as (P91).
 */
const fromWorkerDocument = (document: unknown): DeploymentSettings => {
  if (!isRecord(document)) return { declared: [], ports: [] };
  const env = document['env'];
  const dev = document['dev'];
  const port = isRecord(dev) ? Number(dev['port']) : Number.NaN;
  const blocks = isRecord(env) ? Object.entries(env).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])) : [];
  const bindings = [...bindingsIn(document['services']), ...blocks.flatMap(([name, block]) => bindingsIn(block['services'], name))];
  const names = [literal(document['name']), ...blocks.map(([, block]) => literal(block['name']))].filter(
    (name): name is string => name !== undefined,
  );
  return {
    declared: [
      ...variables(document['vars']),
      ...blocks.flatMap(([name, block]) => variables(block['vars'], { environment: name })),
    ],
    ports: Number.isInteger(port) && port > 0 ? [port] : [],
    ...(bindings.length === 0 ? {} : { bindings }),
    ...(names.length === 0 ? {} : { names: [...new Set(names)] }),
  };
};

export const readWorkerJson = (text: string): DeploymentSettings => {
  try {
    return fromWorkerDocument(parseJsonc(text));
  } catch {
    return { declared: [], ports: [] };
  }
};

/**
 * The TOML spelling, parsed by the core's reader of a worker's configuration
 * (shared with the stream reader, P361).
 */
export const readWorkerToml = (text: string): DeploymentSettings => fromWorkerDocument(readToml(text));
