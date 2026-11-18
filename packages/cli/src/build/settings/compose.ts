import { posix } from 'node:path';
import { parse } from 'yaml';
import type { Written } from './dotenv.js';

/**
 * One container a compose file starts, as far as an address is concerned:
 * what it is called on the network, which directory it is built from, the
 * ports it publishes, and the environment it is started with.
 */
export interface ComposeService {
  /** Its key under `services:`. */
  readonly name: string;
  /** Every other name it answers to on the network: `container_name`, `hostname`, network aliases. */
  readonly aliases: readonly string[];
  /** The directory it is built from, as written, relative to the file. */
  readonly context?: string;
  /**
   * How its image is built, where the file builds it (P325): the Dockerfile,
   * as written, relative to the context (`Dockerfile` where none is named),
   * or one written inline; the stage built (`target`); and the build
   * arguments, `${VAR:-default}` read as for the environment.
   */
  readonly image?: {
    readonly dockerfile?: string;
    readonly inline?: string;
    readonly target?: string;
    readonly args: Readonly<Record<string, string>>;
  };
  /**
   * The image it runs, as `image:` writes it (interpolated): what compose
   * pulls where nothing builds it, and the name it tags what it builds with
   * where `build:` is written too (P331).
   */
  readonly imageName?: string;
  /** Ports published on the machine running it. */
  readonly published: readonly number[];
  /** Each published port with the port inside the container it reaches, and the line it is written on (P254). */
  readonly mappings: readonly Mapping[];
  /** The environment it is started with, `${VAR:-default}` read as its default. */
  readonly environment: readonly Written[];
  /** Environment files it is started with, as written, relative to the file. */
  readonly envFiles: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const scalar = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;

/**
 * A value as the container is given it, where the file settles it.
 *
 * Compose fills `${VAR}` from the shell it is run in, which is nobody's to
 * know here; `${VAR:-default}` and `${VAR-default}` are read as their default,
 * and `$$` as one `$`. A value with any other placeholder is not settled.
 */
export const interpolated = (raw: string, variables: Readonly<Record<string, string>> = {}): string | undefined => {
  let unsettled = false;
  const out = raw.replace(/\$\$|\$\{([^}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced: string | undefined, bare: string | undefined) => {
    if (match === '$$') return '$';
    // The variables compose itself loads, from the `.env` beside the file
    // (P325), fill a placeholder before its default does: `${VAR:-x}` takes
    // a value that is set and not empty, `${VAR-x}` one that is set at all.
    const [, name = bare ?? '', colon, fallback] = braced === undefined ? [] : (/^([A-Za-z_][A-Za-z0-9_]*)(?:(:?)-(.*))?$/.exec(braced) ?? []);
    const given = name === '' ? undefined : variables[name];
    if (given !== undefined && (colon !== ':' || given !== '')) return given;
    if (fallback === undefined) unsettled = true;
    return fallback ?? '';
  });
  return unsettled ? undefined : out;
};

/**
 * `KEY=value` items, or a mapping of them. A setting written with no value -
 * `- PORT`, `PORT:` - is given what compose's own variables give that name
 * (P343): the shell it is run in and the `.env` (or the `--env-file`s,
 * `COMPOSE_ENV_FILES`) it interpolates with, as compose resolves it; one
 * nothing gives is left unset, as compose leaves it.
 */
const environmentOf = (value: unknown, variables: Readonly<Record<string, string>> = {}): Written[] => {
  const out: Written[] = [];
  const push = (name: string, raw: string | undefined): void => {
    if (raw === undefined) return;
    const settled = interpolated(raw, variables);
    if (settled !== undefined && settled !== '') out.push({ name, raw: settled });
  };
  // Taken as it is given, not interpolated again.
  const lookedUp = (name: string): void => {
    const given = variables[name];
    if (given !== undefined && given !== '') out.push({ name, raw: given });
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = scalar(item);
      if (text === undefined) continue;
      const equals = text.indexOf('=');
      if (equals > 0) push(text.slice(0, equals).trim(), text.slice(equals + 1));
      else if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(text.trim())) lookedUp(text.trim());
    }
  } else if (isRecord(value)) {
    for (const [name, raw] of Object.entries(value)) {
      if (raw === null || raw === undefined) lookedUp(name);
      else push(name, scalar(raw));
    }
  }
  return out;
};

/** A port published on the machine, the port inside the container it reaches, and where it is written (P254). */
export interface Mapping {
  readonly published: number;
  readonly container: number;
  readonly line: number;
}

const portNumber = (value: string | undefined): number | undefined => {
  const port = Number(value);
  return value !== undefined && /^\d+$/.test(value.trim()) && port > 0 && port < 65536 ? port : undefined;
};

/** The line an offset of a text is on. */
const lineAt = (text: string, offset: number): number => (offset < 0 ? 1 : text.slice(0, offset).split('\n').length);

/**
 * `"3001:3000"`, `"127.0.0.1:3001:3000/tcp"`, `{ published: 3001, target: 3000 }`:
 * both sides of each mapping, and its line, looked for after `from` (where the
 * container is written). A bare container port publishes nothing fixed, and a
 * range is not one port.
 */
const mappingsOf = (value: unknown, text: string, from: number, variables: Readonly<Record<string, string>> = {}): Mapping[] => {
  if (!Array.isArray(value)) return [];
  const out: Mapping[] = [];
  // A side written as a placeholder is the value compose fills it with (P331).
  const filled = (raw: string | undefined): string | undefined => (raw === undefined ? undefined : interpolated(raw, variables));
  for (const item of value) {
    if (isRecord(item)) {
      const written = scalar(item['published']) ?? '';
      const published = portNumber(filled(written));
      const container = portNumber(filled(scalar(item['target'])));
      if (published === undefined) continue;
      const at = new RegExp(`published\\s*:\\s*['"]?${written.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`).exec(text.slice(from));
      out.push({ published, container: container ?? published, line: lineAt(text, at === null ? -1 : from + at.index) });
      continue;
    }
    const written = scalar(item);
    const settled = filled(written);
    if (written === undefined || settled === undefined) continue;
    const parts = settled.replace(/\/\w+$/, '').split(':');
    if (parts.length < 2) continue;
    const published = portNumber(parts[parts.length - 2]);
    const container = portNumber(parts[parts.length - 1]);
    if (published === undefined || container === undefined) continue;
    out.push({ published, container, line: lineAt(text, text.indexOf(written, from)) });
  }
  return out;
};

/** Where a container's key is written under `services:`, so its own lines are found after it. */
const keyAt = (text: string, name: string): number => {
  const at = new RegExp(`^\\s+['"]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*:`, 'm').exec(text);
  return at === null ? 0 : at.index;
};

const listOf = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    const path = isRecord(item) ? scalar(item['path']) : undefined;
    return path === undefined ? [] : [path];
  });
};

/** Network aliases, under any network. */
const aliasesOf = (networks: unknown): string[] =>
  isRecord(networks)
    ? Object.values(networks).flatMap((network) => (isRecord(network) ? listOf(network['aliases']) : []))
    : [];

/** How a container's image is built, where the file builds it (P325). */
const imageOf = (build: unknown, variables: Readonly<Record<string, string>>): ComposeService['image'] => {
  if (typeof build === 'string') return { args: {} };
  if (!isRecord(build)) return undefined;
  const args: Record<string, string> = {};
  for (const { name, raw } of environmentOf(build['args'], variables)) args[name] = raw;
  const dockerfile = scalar(build['dockerfile']);
  const inline = scalar(build['dockerfile_inline']);
  const target = scalar(build['target']);
  return {
    ...(dockerfile === undefined ? {} : { dockerfile }),
    ...(inline === undefined ? {} : { inline }),
    ...(target === undefined ? {} : { target }),
    args,
  };
};

const documentOf = (text: string): unknown => {
  try {
    return parse(text, { logLevel: 'silent', merge: true });
  } catch {
    return undefined;
  }
};

/** One entry of a compose file's `include:` (P337), each path as written, relative to the file's directory. */
export interface ComposeInclude {
  readonly paths: readonly string[];
  /** The environment files its placeholders are filled from, in place of the `.env` of its project directory. */
  readonly envFiles: readonly string[];
  /** The directory its relative paths are resolved against; the included file's own where none is written. */
  readonly projectDirectory?: string;
}

/**
 * The files a compose file includes (P337): `include: [infra.yaml]`, or
 * `include: [{ path: [a.yaml, b.yaml], env_file: infra.env,
 * project_directory: infra }]`. A path the shell fills is not read.
 */
export const composeIncludes = (text: string): ComposeInclude[] => {
  const document = documentOf(text);
  const include = isRecord(document) ? document['include'] : undefined;
  if (!Array.isArray(include)) return [];
  const settled = (each: string): boolean => each !== '' && !each.includes('$');
  return include.flatMap((item): ComposeInclude[] => {
    if (typeof item === 'string') return settled(item) ? [{ paths: [item], envFiles: [] }] : [];
    if (!isRecord(item)) return [];
    const paths = listOf(item['path']).filter(settled);
    const projectDirectory = scalar(item['project_directory']);
    if (paths.length === 0) return [];
    return [{ paths, envFiles: listOf(item['env_file']).filter(settled), ...(projectDirectory === undefined || !settled(projectDirectory) ? {} : { projectDirectory }) }];
  });
};

/** How deep `extends:` is followed, a base's base and on. */
const EXTENDS_DEPTH = 8;

/** Sequences compose joins rather than replaces when a service extends another. */
const JOINED = new Set(['ports', 'expose', 'env_file', 'dns', 'dns_search', 'tmpfs', 'external_links']);

/** `environment:` and `build.args` as a mapping, a list's `KEY=value` items read as one. */
const asMapping = (value: unknown): Record<string, unknown> => {
  if (isRecord(value)) return { ...value };
  const out: Record<string, unknown> = {};
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    const text = scalar(item);
    if (text === undefined) continue;
    const equals = text.indexOf('=');
    if (equals > 0) out[text.slice(0, equals).trim()] = text.slice(equals + 1);
    else out[text.trim()] = null;
  }
  return out;
};

/** A relative path a base written in another file holds, as the extending file reaches it. */
const rebased = (path: string, from: string): string =>
  from === '.' || path.startsWith('/') || /^[a-z]+:\/\//i.test(path) || path.endsWith('.git') ? path : posix.normalize(posix.join(from, path));

/** A service's paths - its build context and environment files - rebased onto the extending file (P337). */
const rebaseService = (service: Record<string, unknown>, from: string): Record<string, unknown> => {
  if (from === '.') return service;
  const out = { ...service };
  const build = out['build'];
  if (typeof build === 'string') out['build'] = rebased(build, from);
  else if (isRecord(build)) out['build'] = { ...build, context: rebased(scalar(build['context']) ?? '.', from) };
  if (out['env_file'] !== undefined) out['env_file'] = listOf(out['env_file']).map((path) => rebased(path, from));
  return out;
};

/**
 * A service written over the one it extends, as compose merges them (P337):
 * a mapping key by key, `environment:` and `build.args` by setting, the
 * sequences compose joins (`ports`, `env_file`) joined, anything else the
 * extending service's where it writes it.
 */
const mergeService = (base: Record<string, unknown>, own: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(own)) {
    const under = out[key];
    if (key === 'environment') out[key] = { ...asMapping(under), ...asMapping(value) };
    else if (key === 'build' && isRecord(under) && isRecord(value)) out[key] = { ...under, ...value, args: { ...asMapping(under['args']), ...asMapping(value['args']) } };
    else if (JOINED.has(key) && under !== undefined) out[key] = [...new Set([...(key === 'env_file' ? listOf(under) : Array.isArray(under) ? under : [under]), ...(key === 'env_file' ? listOf(value) : Array.isArray(value) ? value : [value])])];
    else if (isRecord(under) && isRecord(value)) out[key] = { ...under, ...value };
    else out[key] = value;
  }
  return out;
};

/** Reads another compose file a service extends from, by its path relative to the file being read; nothing where it is not the project's. */
export type ComposeLoader = (path: string) => string | undefined;

/**
 * A service with what it extends written under it (P337): `extends: base`
 * or `extends: { service: base }` in the same file, `extends: { file:
 * common.yml, service: node }` in another, read as far as the loader reads
 * it, a base's own base and on, its paths rebased onto this file. A base not
 * found leaves the service as written.
 */
const extended = (services: Record<string, unknown>, value: Record<string, unknown>, load: ComposeLoader | undefined, from: string, depth: number): Record<string, unknown> => {
  const written = value['extends'];
  const { extends: _, ...own } = value;
  if (written === undefined || depth >= EXTENDS_DEPTH) return own;
  const target = typeof written === 'string' ? { service: written } : isRecord(written) ? { service: scalar(written['service']), file: scalar(written['file']) } : {};
  if (target.service === undefined) return own;
  let pool = services;
  let at = from;
  if (target.file !== undefined) {
    if (target.file.includes('$') || load === undefined) return own;
    const path = posix.normalize(posix.join(from, target.file));
    const text = load(path);
    const document = text === undefined ? undefined : documentOf(text);
    const found = isRecord(document) ? document['services'] : undefined;
    if (!isRecord(found)) return own;
    pool = found;
    at = posix.dirname(path);
  }
  const base = pool[target.service];
  if (!isRecord(base)) return own;
  return mergeService(rebaseService(extended(pool, base, load, at, depth + 1), posix.relative(from, at) || '.'), own);
};

/**
 * The containers a compose file starts. Nothing for a file that is not one.
 * `variables` are what compose interpolates the file with: the `.env` beside
 * it, or the environment files a command of the project runs it with
 * (`--env-file`), where those are read (P325, P331), and its shell (P337). A
 * name, a port, an environment file or an image written with a placeholder
 * is what they fill it with, or its default; one nothing settles is not
 * read. A service that `extends:` another is read with the other under it,
 * from another file where `load` reads it (P337).
 */
export const readComposeFile = (text: string, variables: Readonly<Record<string, string>> = {}, load?: ComposeLoader): ComposeService[] => {
  const document = documentOf(text);
  const services = isRecord(document) ? document['services'] : undefined;
  if (!isRecord(services)) return [];
  return Object.entries(services).flatMap(([name, entry]) => {
    if (!isRecord(entry)) return [];
    const value = entry['extends'] === undefined ? entry : extended(services, entry, load, '.', 0);
    const build = value['build'];
    const contextWritten = typeof build === 'string' ? build : isRecord(build) ? scalar(build['context']) : undefined;
    const context = contextWritten === undefined ? undefined : (interpolated(contextWritten, variables) ?? contextWritten);
    // A name written with a placeholder is the one compose fills it with, or none (P331).
    const aliases = [scalar(value['container_name']), scalar(value['hostname']), ...aliasesOf(value['networks'])]
      .map((alias) => (alias === undefined ? undefined : interpolated(alias, variables)))
      .filter((alias): alias is string => alias !== undefined && alias !== '' && alias !== name);
    const mappings = mappingsOf(value['ports'], text, keyAt(text, name), variables);
    const image = imageOf(build, variables);
    const written = scalar(value['image']);
    const imageName = written === undefined ? undefined : interpolated(written, variables);
    return [
      {
        name,
        aliases: [...new Set(aliases)],
        ...(context === undefined ? {} : { context }),
        ...(image === undefined ? {} : { image }),
        ...(imageName === undefined || imageName === '' ? {} : { imageName }),
        published: [...new Set(mappings.map((mapping) => mapping.published))],
        mappings,
        environment: environmentOf(value['environment'], variables),
        envFiles: listOf(value['env_file']).flatMap((path) => interpolated(path, variables) ?? []),
      },
    ];
  });
};
