import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A worker's configuration file, read once for everybody who asks it something
 * (P77, P91, P361): `wrangler.json`, `wrangler.jsonc` and `wrangler.toml`.
 *
 * The settings reader asks it for variables, the port, the workers it is bound
 * to and the names it is deployed under; the stream reader asks it which class
 * each of its per-scope objects (Durable Objects) is. Both read the same
 * document, so the two spellings of the file are parsed here and nowhere else.
 */

/** The names a worker's configuration file is written under, in the order they are preferred. */
export const WORKER_CONFIG_FILES: readonly string[] = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** JSON with comments and trailing commas, as a worker's configuration is written. */
export const parseJsonc = (text: string): unknown => {
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
  const body = /^\{(.*)\}\s*(?:#.*)?$/s.exec(written.trim())?.[1];
  if (body === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const pair of body.match(/[A-Za-z0-9_.-]+\s*=\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^,]+)/g) ?? []) {
    const equals = pair.indexOf('=');
    const value = tomlValue(pair.slice(equals + 1));
    if (value !== undefined) out[pair.slice(0, equals).trim().replace(/^"|"$/g, '')] = value;
  }
  return out;
};

/** `[{ a = "x" }, { b = "y" }]`, an inline array of inline tables, on one line or several. */
const inlineArray = (written: string): Record<string, unknown>[] | undefined => {
  const body = /^\[(.*)\]\s*(?:#.*)?$/s.exec(written.trim())?.[1];
  if (body === undefined) return undefined;
  const tables = body.match(/\{[^{}]*\}/g) ?? [];
  return tables.map((table) => inlineTable(table)).filter((table): table is Record<string, unknown> => table !== undefined);
};

/** How far a value written over several lines still has to close: brackets and braces opened, outside strings and comments. */
const openBrackets = (text: string): number => {
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quote !== undefined) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '#') {
      while (index < text.length && text[index] !== '\n') index += 1;
    } else if (char === '[' || char === '{') depth += 1;
    else if (char === ']' || char === '}') depth -= 1;
  }
  return depth;
};

/**
 * The arrays of tables read: `[[services]]` (P91) and the bindings of a
 * worker's per-scope objects, `[[durable_objects.bindings]]` (P361).
 */
const READ_TABLE_ARRAYS: ReadonlySet<string> = new Set(['services', 'bindings']);

/**
 * The part of a worker's TOML configuration that holds variables and
 * bindings: tables and inline tables of strings and numbers, which is all
 * `vars` and `dev` are, the arrays of tables `services` and
 * `durable_objects.bindings` are written as (`[[services]]` or
 * `services = [{ … }]`, on one line or over several). Everything else in the
 * file is skipped, not misread.
 */
export const readWorkerToml = (text: string): Record<string, unknown> => {
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
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] as string).trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[([^[\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (header !== null) {
      table = tableAt((header[1] as string).split('.').map((key) => key.trim().replace(/^"|"$/g, '')));
      continue;
    }
    // An array of tables: one more entry of the list at that path. Only the
    // ones named above are read; `[[routes]]` and the rest hold nothing here.
    const arrayHeader = /^\[\[([^[\]]+)\]\]\s*(?:#.*)?$/.exec(line);
    if (arrayHeader !== null) {
      const path = (arrayHeader[1] as string).split('.').map((key) => key.trim().replace(/^"|"$/g, ''));
      const last = path.pop() as string;
      if (!READ_TABLE_ARRAYS.has(last)) {
        table = undefined;
        continue;
      }
      const owner = tableAt(path);
      const list = Array.isArray(owner[last]) ? (owner[last] as unknown[]) : [];
      const made: Record<string, unknown> = {};
      list.push(made);
      owner[last] = list;
      table = made;
      continue;
    }
    const pair = /^([A-Za-z0-9_."-]+)\s*=\s*(.*)$/.exec(line);
    if (pair === null || table === undefined) continue;
    const key = (pair[1] as string).replace(/^"|"$/g, '');
    let written = pair[2] as string;
    // A value that opens a bracket it does not close goes on to the lines below.
    while (openBrackets(written) > 0 && index + 1 < lines.length) {
      index += 1;
      written += `\n${lines[index] as string}`;
    }
    const trimmed = written.trim();
    const value = trimmed.startsWith('{') ? inlineTable(written) : trimmed.startsWith('[') ? inlineArray(written) : tomlValue(written);
    if (value === undefined) continue;
    // `durable_objects.bindings = [...]`, a dotted key, is the table it names.
    const path = key.split('.');
    const last = path.pop() as string;
    let into = table;
    for (const part of path) {
      const next = into[part];
      if (isRecord(next)) into = next;
      else {
        const made: Record<string, unknown> = {};
        into[part] = made;
        into = made;
      }
    }
    into[last] = value;
  }
  return root;
};

/** A worker's configuration document, whichever way the file is written; nothing where it does not parse. */
export const readWorkerDocument = (text: string, fileName: string): Record<string, unknown> | undefined => {
  try {
    const document = fileName.endsWith('.toml') ? readWorkerToml(text) : parseJsonc(text);
    return isRecord(document) ? document : undefined;
  } catch {
    return undefined;
  }
};

/** A value written out: a string with no placeholder in it. */
const literal = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' && !value.includes('${') ? value : undefined;

/**
 * One per-scope object (Durable Object) a worker's configuration binds:
 * `durable_objects.bindings: [{ name, class_name, script_name? }]` (P361).
 * The code reaches the namespace as `env.<binding>`; the class it is made of
 * is `className`, declared by this worker, or by the worker deployed as
 * `scriptName` where one is named.
 */
export interface ObjectBinding {
  readonly binding: string;
  readonly className: string;
  /** The worker that declares the class, where it is another one. */
  readonly scriptName?: string;
  /** The environment it is declared for, when the file declares several. */
  readonly environment?: string;
  /** The file it is declared in, relative to the repository. */
  readonly file: string;
}

const objectBindingsIn = (value: unknown, file: string, environment?: string): ObjectBinding[] => {
  const list = isRecord(value) ? value['bindings'] : undefined;
  return Array.isArray(list)
    ? list.flatMap((item) => {
        if (!isRecord(item)) return [];
        const binding = literal(item['name']);
        const className = literal(item['class_name']);
        const scriptName = literal(item['script_name']);
        if (binding === undefined || className === undefined) return [];
        return [
          {
            binding,
            className,
            ...(scriptName === undefined ? {} : { scriptName }),
            ...(environment === undefined ? {} : { environment }),
            file,
          },
        ];
      })
    : [];
};

/** The per-scope objects a configuration document binds, its own and each environment's. */
export const objectBindingsOf = (document: Record<string, unknown>, file: string): ObjectBinding[] => {
  const env = document['env'];
  const blocks = isRecord(env) ? Object.entries(env).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])) : [];
  return [
    ...objectBindingsIn(document['durable_objects'], file),
    ...blocks.flatMap(([name, block]) => objectBindingsIn(block['durable_objects'], file, name)),
  ];
};

/** What a repository's worker configuration says about its code: the module it starts from, and its per-scope objects. */
export interface WorkerConfig {
  /** The file it is read from, relative to the repository. */
  readonly file: string;
  /** The module the worker starts from (`main`), relative to the repository. */
  readonly main?: string;
  readonly objects: readonly ObjectBinding[];
}

/** The worker configuration at a repository's root, where there is one that parses. */
export const readWorkerConfig = (repoDir: string): WorkerConfig | undefined => {
  for (const name of WORKER_CONFIG_FILES) {
    const path = join(repoDir, name);
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const document = readWorkerDocument(text, name);
    if (document === undefined) continue;
    const main = literal(document['main']);
    return { file: name, ...(main === undefined ? {} : { main: main.replace(/^\.\//, '') }), objects: objectBindingsOf(document, name) };
  }
  return undefined;
};
