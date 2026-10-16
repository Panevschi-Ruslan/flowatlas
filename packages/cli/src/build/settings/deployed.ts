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

/** What a deployment file says: its variables, and the port it is run on locally. */
export interface DeploymentSettings {
  readonly declared: readonly Declared[];
  readonly ports: readonly number[];
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

/** JSON with comments and trailing commas, as a worker's configuration is written. */
const parseJsonc = (text: string): unknown => {
  let out = '';
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    const next = text[index + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 1;
      } else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      out += '\n';
    } else if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index += 1;
    } else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
};

/** `vars`, and `env.<name>.vars` for one environment; `dev.port` is where it runs locally. */
const fromWorkerDocument = (document: unknown): DeploymentSettings => {
  if (!isRecord(document)) return { declared: [], ports: [] };
  const env = document['env'];
  const dev = document['dev'];
  const port = isRecord(dev) ? Number(dev['port']) : Number.NaN;
  return {
    declared: [
      ...variables(document['vars']),
      ...(isRecord(env)
        ? Object.entries(env).flatMap(([name, block]) => variables(isRecord(block) ? block['vars'] : undefined, { environment: name }))
        : []),
    ],
    ports: Number.isInteger(port) && port > 0 ? [port] : [],
  };
};

export const readWorkerJson = (text: string): DeploymentSettings => {
  try {
    return fromWorkerDocument(parseJsonc(text));
  } catch {
    return { declared: [], ports: [] };
  }
};

/** A TOML string or number, as a worker's configuration writes one. */
const tomlValue = (written: string): string | number | undefined => {
  const text = written.trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(text);
  if (quoted !== null) return quoted[1] !== undefined ? quoted[1].replace(/\\(.)/g, '$1') : quoted[2];
  const number = /^(\d+)\s*(?:#.*)?$/.exec(text);
  return number === null ? undefined : Number(number[1]);
};

/** `{ A = "x", B = "y" }`, one level deep. */
const inlineTable = (written: string): Record<string, unknown> | undefined => {
  const body = /^\{(.*)\}\s*(?:#.*)?$/.exec(written.trim())?.[1];
  if (body === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const pair of body.match(/[A-Za-z0-9_.-]+\s*=\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^,]+)/g) ?? []) {
    const equals = pair.indexOf('=');
    const value = tomlValue(pair.slice(equals + 1));
    if (value !== undefined) out[pair.slice(0, equals).trim().replace(/^"|"$/g, '')] = value;
  }
  return out;
};

/**
 * The part of a worker's TOML configuration that holds variables: tables and
 * inline tables of strings and numbers, which is all `vars` and `dev` are.
 * Everything else in the file is skipped, not misread.
 */
const readToml = (text: string): Record<string, unknown> => {
  const root: Record<string, unknown> = {};
  let table: Record<string, unknown> | undefined = root;
  const tableAt = (path: string[]): Record<string, unknown> => {
    let at = root;
    for (const key of path) {
      const next = at[key];
      if (isRecord(next)) at = next;
      else {
        const made: Record<string, unknown> = {};
        at[key] = made;
        at = made;
      }
    }
    return at;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[([^[\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (header !== null) {
      table = tableAt((header[1] as string).split('.').map((key) => key.trim().replace(/^"|"$/g, '')));
      continue;
    }
    // An array of tables (`[[routes]]`) holds nothing read here.
    if (line.startsWith('[[')) {
      table = undefined;
      continue;
    }
    const pair = /^([A-Za-z0-9_."-]+)\s*=\s*(.*)$/.exec(line);
    if (pair === null || table === undefined) continue;
    const key = (pair[1] as string).replace(/^"|"$/g, '');
    const written = pair[2] as string;
    const value = written.trim().startsWith('{') ? inlineTable(written) : tomlValue(written);
    if (value !== undefined) table[key] = value;
  }
  return root;
};

export const readWorkerToml = (text: string): DeploymentSettings => fromWorkerDocument(readToml(text));
